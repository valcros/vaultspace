/**
 * Document Thumbnail API
 *
 * GET /api/rooms/:roomId/documents/:documentId/thumbnail
 *
 * Returns a PNG thumbnail for grid view. Falls back to generating one
 * from the original file for images, or returns 404 if no thumbnail exists.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: roomId, organizationId: session.organizationId },
      });
      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      const document = await tx.document.findFirst({
        where: {
          id: documentId,
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

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      return { document };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    const { document } = result;
    const latestVersion = document.versions[0];
    if (!latestVersion) {
      return NextResponse.json({ error: 'No version' }, { status: 404 });
    }

    const providers = getProviders();
    const storage = providers.storage;

    // Try serving the THUMBNAIL asset first
    const thumbnailAsset = latestVersion.previewAssets?.[0];
    if (thumbnailAsset) {
      const exists = await storage.exists('previews', thumbnailAsset.storageKey);
      if (exists) {
        const data = await storage.get('previews', thumbnailAsset.storageKey);
        return new NextResponse(new Uint8Array(data), {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': data.length.toString(),
            'Cache-Control': 'private, max-age=300',
          },
        });
      }
    }

    // For images, generate a thumbnail on the fly from the original file
    const mimeType = document.mimeType || '';
    if (mimeType.startsWith('image/') && latestVersion.fileBlob) {
      const bucket = latestVersion.fileBlob.storageBucket || 'documents';
      const key = latestVersion.fileBlob.storageKey;
      const exists = await storage.exists(bucket, key);
      if (exists) {
        const data = await storage.get(bucket, key);
        // Use sharp to resize to thumbnail
        const sharp = (await import('sharp')).default;
        const thumbnail = await sharp(Buffer.from(data))
          .resize(400, 300, { fit: 'cover', position: 'top' })
          .png({ quality: 80 })
          .toBuffer();

        return new NextResponse(new Uint8Array(thumbnail), {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': thumbnail.length.toString(),
            'Cache-Control': 'private, max-age=300',
          },
        });
      }
    }

    // No thumbnail available
    return NextResponse.json({ error: 'No thumbnail available' }, { status: 404 });
  } catch (error) {
    console.error('[ThumbnailAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to get thumbnail' }, { status: 500 });
  }
}
