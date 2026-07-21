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
import { isServable } from '@/lib/documents/scanGate';
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
  'text/markdown',
  'text/html',
  'text/yaml',
  'text/xml',
  'application/json',
  'application/xml',
]);

// All responses from this route need X-Frame-Options: SAMEORIGIN to allow iframe embedding
const FRAME_HEADERS = { 'X-Frame-Options': 'SAMEORIGIN' };

function jsonResponse(data: object, status: number) {
  return NextResponse.json(data, { status, headers: FRAME_HEADERS });
}

// NOTE (2026-07-02, QA regression): a previous change served binary previews
// via 302 redirects to cross-origin signed storage URLs. That broke previews
// in production use: ConvertedPreview loads converted office-document assets
// with fetch(), which CORS-blocks after a cross-origin redirect, and PDF
// iframes depend on inline Content-Type/Content-Disposition headers that the
// raw storage URL does not guarantee. ALL previews are app-served again.
// The signed-URL offload returns to the backlog with hard requirements:
// SAS/presign content-type + disposition overrides, and img/iframe-only
// consumers (never fetch()-consumed assets).

/**
 * GET /api/rooms/:roomId/documents/:documentId/preview
 * Get document preview for authenticated admin
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;
    const versionId = request.nextUrl.searchParams.get('versionId');
    // Which rendered page to serve (Office docs / spreadsheets render to one PNG
    // per page). Defaults to page 1.
    const pageParam = Math.max(
      1,
      parseInt(request.nextUrl.searchParams.get('page') || '1', 10) || 1
    );

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

      // Get the document (without versions — we load the version separately if needed)
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
          status: 'ACTIVE',
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Version include shape shared by both queries
      const versionInclude = {
        fileBlob: {
          select: {
            storageKey: true,
            storageBucket: true,
          },
        },
        previewAssets: {
          where: {
            assetType: { in: ['RENDER' as const, 'PDF' as const] },
            pageNumber: pageParam,
          },
          take: 1,
        },
      };

      let selectedVersion;

      if (versionId) {
        // Load specific version — must belong to the same document and organization
        selectedVersion = await tx.documentVersion.findFirst({
          where: {
            id: versionId,
            documentId,
            organizationId: session.organizationId,
          },
          include: versionInclude,
        });

        if (!selectedVersion) {
          return { error: 'Document version not found', status: 404 };
        }
      } else {
        // Load latest version
        selectedVersion = await tx.documentVersion.findFirst({
          where: {
            documentId,
            organizationId: session.organizationId,
          },
          orderBy: { versionNumber: 'desc' },
          include: versionInclude,
        });
      }

      if (!selectedVersion || !selectedVersion.fileBlob) {
        return { error: 'Document version not found', status: 404 };
      }
      // Never serve a preview derived from an INFECTED / still-scanning original.
      if (!isServable(selectedVersion.scanStatus)) {
        return { error: 'Preview is not available for this document', status: 403 };
      }

      // Total rendered pages, so the viewer can paginate multi-page renders.
      const totalRenderPages = await tx.previewAsset.count({
        where: { versionId: selectedVersion.id, assetType: 'RENDER' },
      });

      return { document, selectedVersion, totalRenderPages };
    });

    if ('error' in result) {
      return jsonResponse({ error: result.error }, result.status || 500);
    }

    // Queue document view notification (non-blocking). The worker processor
    // also increments document.viewCount (incrementViewCount flag), keeping
    // the hot-row UPDATE out of the request path entirely (audit finding 16).
    try {
      const providers = getProviders();
      providers.job
        .addJob('normal', 'notify-document-viewed', {
          organizationId: session.organizationId,
          roomId,
          documentId,
          viewerId: session.userId,
          incrementViewCount: true,
        })
        .catch(() => {}); // Fire and forget
    } catch {
      // Non-critical — don't block preview
    }

    const { document, selectedVersion, totalRenderPages } = result;
    const mimeType = document.mimeType || 'application/octet-stream';

    // Get storage provider
    const providers = getProviders();
    const storage = providers.storage;

    // For previewable types, return the original file inline
    if (PREVIEWABLE_MIME_TYPES.has(mimeType)) {
      const bucket = selectedVersion.fileBlob!.storageBucket || 'documents';
      const key = selectedVersion.fileBlob!.storageKey;

      // Check if file exists
      const exists = await storage.exists(bucket, key);
      if (!exists) {
        return jsonResponse({ error: 'File not found in storage' }, 404);
      }

      // Get file content
      const data = await storage.get(bucket, key);

      // Return file with inline headers for preview
      // X-Frame-Options: SAMEORIGIN allows iframe embedding within same origin for preview dialogs
      // Serve HTML as text/plain to prevent XSS if it ever reaches an iframe
      const safeContentType = mimeType === 'text/html' ? 'text/plain' : mimeType;

      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': safeContentType,
          'Content-Length': data.length.toString(),
          'Content-Disposition': `inline; filename="${encodeURIComponent(document.name)}"`,
          'Cache-Control': 'private, max-age=300',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    }

    // For non-previewable types, check if we have a generated preview asset
    const previewAsset = selectedVersion.previewAssets?.[0];
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
            'X-Total-Pages': String(Math.max(totalRenderPages, 1)),
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
      404
    );
  } catch (error) {
    console.error('[AdminPreviewAPI] Error:', error);
    return jsonResponse({ error: 'Failed to get preview' }, 500);
  }
}
