/**
 * Regenerate Previews API
 *
 * POST /api/rooms/:roomId/regenerate-previews
 *
 * Re-queues preview generation for all documents in a room that are missing
 * preview assets. Admin-only endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: roomId, organizationId: session.organizationId },
      });
      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Find all active documents with their latest version
      const documents = await tx.document.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
          status: 'ACTIVE',
        },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            include: {
              fileBlob: {
                select: { storageKey: true, storageBucket: true },
              },
              previewAssets: {
                where: { assetType: 'THUMBNAIL' },
                take: 1,
              },
            },
          },
        },
      });

      // Filter to documents missing thumbnails
      const needsPreview = documents.filter((doc) => {
        const version = doc.versions[0];
        if (!version || !version.fileBlob) return false;
        // Re-queue if no thumbnail asset exists
        return version.previewAssets.length === 0;
      });

      return { documents: needsPreview };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    const providers = getProviders();
    let queued = 0;

    for (const doc of result.documents) {
      const version = doc.versions[0];
      if (!version || !version.fileBlob) continue;

      const storageKey = version.fileBlob.storageKey;

      await providers.job.addJob(
        'high',
        'preview.generate',
        {
          documentId: doc.id,
          versionId: version.id,
          organizationId: session.organizationId,
          storageKey,
          contentType: doc.mimeType,
          fileName: doc.name,
          fileSizeBytes: Number(doc.fileSize),
          isScanned: true,
        },
        { priority: 'high' }
      );
      queued++;
    }

    return NextResponse.json({
      success: true,
      queued,
      total: result.documents.length,
      message: `Queued ${queued} documents for preview regeneration`,
    });
  } catch (error) {
    console.error('[RegeneratePreviewsAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to regenerate previews' }, { status: 500 });
  }
}
