/**
 * Admin Document Preview API
 *
 * GET /api/rooms/:roomId/documents/:documentId/preview - Get document preview
 *
 * Returns the document for inline viewing (PDFs, images) or preview assets.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

// MIME types that can be previewed inline
// Types that can be served inline without conversion
const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'text/plain',
  'text/csv',
]);

// All responses from this route need X-Frame-Options: SAMEORIGIN to allow iframe embedding
const FRAME_HEADERS = { 'X-Frame-Options': 'SAMEORIGIN' };

function jsonResponse(data: object, status: number) {
  return NextResponse.json(data, { status, headers: FRAME_HEADERS });
}

/**
 * GET /api/rooms/:roomId/documents/:documentId/preview
 * Get document preview for authenticated admin
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

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

      // Get document with its latest version, file blob, and preview assets
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
                select: {
                  storageKey: true,
                  storageBucket: true,
                },
              },
              previewAssets: {
                where: { assetType: { in: ['RENDER', 'PDF'] }, pageNumber: 1 },
                take: 1,
              },
            },
          },
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      const latestVersion = document.versions[0];
      if (!latestVersion || !latestVersion.fileBlob) {
        return { error: 'Document version not found', status: 404 };
      }

      // Record the view event
      await tx.document.update({
        where: { id: document.id },
        data: {
          viewCount: { increment: 1 },
        },
      });

      return { document, latestVersion };
    });

    if ('error' in result) {
      return jsonResponse({ error: result.error }, result.status || 500);
    }

    const { document, latestVersion } = result;
    const mimeType = document.mimeType || 'application/octet-stream';

    // Get storage provider
    const providers = getProviders();
    const storage = providers.storage;

    // For previewable types, return the original file inline
    if (PREVIEWABLE_MIME_TYPES.has(mimeType)) {
      const bucket = latestVersion.fileBlob!.storageBucket || 'documents';
      const key = latestVersion.fileBlob!.storageKey;

      // Check if file exists
      const exists = await storage.exists(bucket, key);
      if (!exists) {
        return jsonResponse({ error: 'File not found in storage' }, 404);
      }

      // Get file content
      const data = await storage.get(bucket, key);

      // Return file with inline headers for preview
      // X-Frame-Options: SAMEORIGIN allows iframe embedding within same origin for preview dialogs
      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': data.length.toString(),
          'Content-Disposition': `inline; filename="${encodeURIComponent(document.name)}"`,
          'Cache-Control': 'private, max-age=300',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    }

    // For non-previewable types, check if we have a generated preview asset
    const previewAsset = latestVersion.previewAssets?.[0];
    if (previewAsset) {
      const bucket = 'previews';
      const key = previewAsset.storageKey;
      const contentType = previewAsset.mimeType || 'image/png';

      const exists = await storage.exists(bucket, key);
      if (exists) {
        const data = await storage.get(bucket, key);
        return new NextResponse(new Uint8Array(data), {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': data.length.toString(),
            'Content-Disposition': `inline; filename="${encodeURIComponent(document.name)}.${contentType === 'application/pdf' ? 'pdf' : 'png'}"`,
            'Cache-Control': 'private, max-age=300',
            'X-Frame-Options': 'SAMEORIGIN',
          },
        });
      }
    }

    // No preview available - return metadata about the document
    return jsonResponse(
      {
        message: 'Preview not available for this file type',
        document: {
          id: document.id,
          name: document.name,
          mimeType: document.mimeType,
          canPreview: false,
        },
      },
      200
    );
  } catch (error) {
    console.error('[AdminPreviewAPI] Error:', error);
    return jsonResponse({ error: 'Failed to get preview' }, 500);
  }
}
