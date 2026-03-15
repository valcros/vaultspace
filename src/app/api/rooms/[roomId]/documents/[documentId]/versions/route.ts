/**
 * Document Versions API (F002)
 *
 * GET  /api/rooms/:roomId/documents/:documentId/versions - List versions
 * POST /api/rooms/:roomId/documents/:documentId/versions - Upload new version
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';
import { getProviders } from '@/providers';
import { createHash } from 'crypto';
import { sanitizeFilename } from '@/lib/fileTypes';

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

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    // Get document with all versions
    const document = await db.document.findFirst({
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
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ versions: document.versions });
  } catch (error) {
    console.error('[VersionsAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to list versions' },
      { status: 500 }
    );
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
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    // Get existing document
    const document = await db.document.findFirst({
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
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const changeDescription = formData.get('changeDescription') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Read file data
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileSha256 = createHash('sha256').update(buffer).digest('hex');

    // Calculate new version number
    const latestVersion = document.versions[0];
    const newVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

    // Calculate version hash (includes parent hash for chain integrity)
    const parentHash = latestVersion?.versionHash ?? null;
    const versionHashInput = `${fileSha256}:${newVersionNumber}:${parentHash ?? 'root'}`;
    const versionHash = createHash('sha256').update(versionHashInput).digest('hex');

    // Create storage key
    const sanitizedFilename = sanitizeFilename(file.name);
    const storageKey = `${session.organizationId}/documents/${documentId}/versions/v${newVersionNumber}/original/${sanitizedFilename}`;

    // Upload to storage
    const providers = getProviders();
    await providers.storage.put('documents', storageKey, buffer);

    // Create version record
    const newVersion = await db.$transaction(async (tx) => {
      const version = await tx.documentVersion.create({
        data: {
          organizationId: session.organizationId,
          documentId,
          versionNumber: newVersionNumber,
          uploadedByUserId: session.userId,
          changeDescription,
          mimeType: file.type || 'application/octet-stream',
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
          mimeType: file.type || document.mimeType,
          fileSize: BigInt(buffer.length),
        },
      });

      return version;
    });

    // Queue processing jobs
    await providers.job.addJob('document', 'document.scan', {
      versionId: newVersion.id,
      organizationId: session.organizationId,
    });

    return NextResponse.json({ version: newVersion }, { status: 201 });
  } catch (error) {
    console.error('[VersionsAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to upload version' },
      { status: 500 }
    );
  }
}
