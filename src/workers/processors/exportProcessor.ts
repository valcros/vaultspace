/**
 * Export Job Processor (F113)
 *
 * Processes room export jobs - creates ZIP archives of room documents.
 */

import { Job } from 'bullmq';
import archiver from 'archiver';
import { PassThrough } from 'stream';

import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

export interface RoomExportJobPayload {
  roomId: string;
  organizationId: string;
  requestedByUserId: string;
  options: {
    includeOriginals?: boolean;
    includePreviews?: boolean;
    includeMetadata?: boolean;
    documentIds?: string[];
    folderId?: string;
    sendEmail?: boolean;
  };
}

export async function processRoomExportJob(job: Job<RoomExportJobPayload>): Promise<void> {
  const { roomId, organizationId, requestedByUserId, options } = job.data;

  console.log(`[ExportProcessor] Starting export for room ${roomId}`);

  const providers = getProviders();

  try {
    const { room, documents } = await withOrgContext(organizationId, async (tx) => {
      // Get room info
      const roomRecord = await tx.room.findFirst({
        where: { id: roomId, organizationId },
        select: { id: true, name: true },
      });

      if (!roomRecord) {
        return { room: null, documents: [] };
      }

      // Build document query
      const documentWhere: {
        roomId: string;
        organizationId: string;
        status: 'ACTIVE';
        id?: { in: string[] };
        folderId?: string;
      } = {
        roomId,
        organizationId,
        status: 'ACTIVE',
      };

      if (options.documentIds?.length) {
        documentWhere.id = { in: options.documentIds };
      }

      if (options.folderId) {
        documentWhere.folderId = options.folderId;
      }

      // Get documents to export with their versions and file blobs
      const documentRecords = await tx.document.findMany({
        where: documentWhere,
        include: {
          folder: {
            select: { name: true, path: true },
          },
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: options.includeOriginals ? undefined : 1,
            include: {
              fileBlob: {
                select: {
                  storageKey: true,
                  storageBucket: true,
                },
              },
            },
          },
        },
      });

      return { room: roomRecord, documents: documentRecords };
    });

    if (!room) {
      throw new Error('Room not found');
    }

    if (documents.length === 0) {
      console.log(`[ExportProcessor] No documents to export for room ${roomId}`);
      return;
    }

    console.log(`[ExportProcessor] Exporting ${documents.length} documents`);

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Compression level
    });

    // Create a passthrough stream to collect the ZIP
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on('data', (chunk) => chunks.push(chunk));

    const archiveFinished = new Promise<void>((resolve, reject) => {
      passthrough.on('end', resolve);
      passthrough.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(passthrough);

    // Add documents to archive
    for (const doc of documents) {
      const folderPath = doc.folder?.path
        ? doc.folder.path.replace(/^\//, '').replace(/\//g, '/')
        : '';

      for (const version of doc.versions) {
        if (!version.fileBlob) {
          console.warn(`[ExportProcessor] No file blob for version ${version.id}`);
          continue;
        }

        try {
          // Get file from storage
          const fileBuffer = await providers.storage.get(
            version.fileBlob.storageBucket,
            version.fileBlob.storageKey
          );

          // Determine filename
          const extension = getExtensionFromMimeType(version.mimeType);
          const versionSuffix = doc.versions.length > 1 ? `_v${version.versionNumber}` : '';
          const fileName = `${sanitizeFileName(doc.name)}${versionSuffix}${extension}`;

          // Full path in ZIP
          const zipPath = folderPath ? `${folderPath}/${fileName}` : fileName;

          // Add file to archive
          archive.append(fileBuffer, {
            name: zipPath,
            date: version.createdAt,
          });

          console.log(`[ExportProcessor] Added: ${zipPath}`);
        } catch (fileError) {
          console.error(`[ExportProcessor] Failed to add ${doc.name}:`, fileError);
          // Continue with other files
        }
      }
    }

    // Add metadata JSON if requested
    if (options.includeMetadata) {
      const metadata = {
        roomName: room.name,
        exportedAt: new Date().toISOString(),
        documentCount: documents.length,
        documents: documents.map((doc) => ({
          name: doc.name,
          folder: doc.folder?.path ?? '/',
          versions: doc.versions.map((v) => ({
            version: v.versionNumber,
            mimeType: v.mimeType,
            size: Number(v.fileSize),
            uploadedAt: v.createdAt.toISOString(),
          })),
        })),
      };

      archive.append(JSON.stringify(metadata, null, 2), { name: '_metadata.json' });
    }

    // Finalize archive
    await archive.finalize();

    // Wait for stream to finish
    await archiveFinished;

    // Combine chunks into final buffer
    const zipBuffer = Buffer.concat(chunks);

    console.log(`[ExportProcessor] ZIP created: ${zipBuffer.length} bytes`);

    // Store the export file
    const exportKey = `exports/${organizationId}/${roomId}/${Date.now()}.zip`;
    await providers.storage.put('documents', exportKey, zipBuffer);

    const user = await withOrgContext(organizationId, async (tx) => {
      // Create export event
      await tx.event.create({
        data: {
          organizationId,
          roomId,
          actorType: 'ADMIN',
          actorId: requestedByUserId,
          eventType: 'ADMIN_EXPORT_INITIATED',
          metadata: {
            documentCount: documents.length,
            exportKey,
            zipSize: zipBuffer.length,
          },
        },
      });

      // Notify the requesting user with a signed download link (valid 24 hours)
      return tx.user.findUnique({
        where: { id: requestedByUserId },
        select: { email: true, firstName: true },
      });
    });

    if (options.sendEmail !== false && user?.email) {
      try {
        const downloadUrl = await providers.storage.getSignedUrl(
          'documents',
          exportKey,
          24 * 60 * 60
        );
        await providers.email.sendEmail({
          to: user.email,
          subject: `Your export of "${room.name}" is ready`,
          html: `<p>Hi ${user.firstName ?? 'there'},</p>
<p>Your export of <strong>${room.name}</strong> is ready to download.</p>
<p><a href="${downloadUrl}">Download ZIP (${Math.round(zipBuffer.length / 1024)} KB)</a></p>
<p>This link expires in 24 hours.</p>`,
        });
      } catch (emailError) {
        console.error(`[ExportProcessor] Failed to send download email:`, emailError);
      }
    }

    console.log(`[ExportProcessor] Export completed: ${exportKey}`);
  } catch (error) {
    console.error(`[ExportProcessor] Export failed for room ${roomId}:`, error);
    throw error;
  }
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/msword': '.doc',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.ms-powerpoint': '.ppt',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };

  return mimeToExt[mimeType] ?? '';
}

/**
 * Sanitize filename for ZIP archive
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}
