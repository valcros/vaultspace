/**
 * Document Versions API (F002)
 *
 * GET  /api/rooms/:roomId/documents/:documentId/versions - List versions
 * POST /api/rooms/:roomId/documents/:documentId/versions - Upload new version
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { createHash } from 'crypto';
import { sanitizeFilename, resolveMimeType } from '@/lib/fileTypes';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

/**
 * GET /api/rooms/:roomId/documents/:documentId/versions
 * List all versions of a document
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Use RLS context for org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Get document with all versions
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            include: {
              uploadedByUser: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              previewAssets: {
                where: { assetType: 'THUMBNAIL' },
                take: 1,
              },
            },
          },
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      return { versions: document.versions };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ versions: result.versions });
  } catch (error) {
    console.error('[VersionsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list versions' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/documents/:documentId/versions
 * Upload a new version of the document
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse multipart form data (can be done outside transaction)
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const changeDescription = formData.get('changeDescription') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Read file data and calculate hash (can be done outside transaction)
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileSha256 = createHash('sha256').update(buffer).digest('hex');
    const sanitizedFilename = sanitizeFilename(file.name);
    // Resolve MIME type - browsers may report incorrect type for some formats (e.g., DXF)
    const mimeType = resolveMimeType(file.name, file.type || '');

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      if (room.status === 'CLOSED' || room.status === 'ARCHIVED') {
        return {
          error: 'Cannot upload documents to a closed or archived room',
          status: 403,
        };
      }

      // Get existing document
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Calculate new version number
      const latestVersion = document.versions[0];
      const newVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

      // Calculate version hash (includes parent hash for chain integrity)
      const parentHash = latestVersion?.versionHash ?? null;
      const versionHashInput = `${fileSha256}:${newVersionNumber}:${parentHash ?? 'root'}`;
      const versionHash = createHash('sha256').update(versionHashInput).digest('hex');

      // Create storage key
      const storageKey = `${session.organizationId}/documents/${documentId}/versions/v${newVersionNumber}/original/${sanitizedFilename}`;

      // Upload to storage (within RLS context but before DB writes)
      const providers = getProviders();
      await providers.storage.put('documents', storageKey, buffer);

      // Create version record
      const version = await tx.documentVersion.create({
        data: {
          organizationId: session.organizationId,
          documentId,
          versionNumber: newVersionNumber,
          uploadedByUserId: session.userId,
          changeDescription,
          mimeType,
          fileSize: BigInt(buffer.length),
          fileName: sanitizedFilename,
          fileSha256,
          versionHash,
          parentVersionHash: parentHash,
          previewStatus: 'PENDING',
          scanStatus: 'PENDING',
        },
      });

      // Create file blob record
      await tx.fileBlob.create({
        data: {
          organizationId: session.organizationId,
          versionId: version.id,
          storageKey,
          storageBucket: 'documents',
        },
      });

      // Update document
      await tx.document.update({
        where: { id: documentId },
        data: {
          currentVersionId: version.id,
          totalVersions: { increment: 1 },
          mimeType: mimeType || document.mimeType,
          fileSize: BigInt(buffer.length),
        },
      });

      return { version, storageKey, document };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Queue processing jobs (high priority queue) - outside transaction
    const providers = getProviders();
    await providers.job.addJob('high', 'document.scan', {
      documentId,
      versionId: result.version.id,
      organizationId: session.organizationId,
      storageKey: result.storageKey,
      contentType: file.type || result.document.mimeType,
      fileName: file.name,
    });

    return NextResponse.json({ version: result.version }, { status: 201 });
  } catch (error) {
    console.error('[VersionsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to upload version' }, { status: 500 });
  }
}
