/**
 * Viewer Document Preview API
 *
 * GET /api/view/[shareToken]/documents/[documentId]/preview - Get document preview image
 *
 * Returns a redirect to a signed URL for the preview image, or the image directly.
 */

import { NextRequest, NextResponse } from 'next/server';

import { withOrgContext } from '@/lib/db';
import { isServable, SERVABLE_SCAN_STATUS_FILTER } from '@/lib/documents/scanGate';
import {
  getViewerSession,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';
import { getProviders } from '@/providers';

interface RouteContext {
  params: Promise<{ shareToken: string; documentId: string }>;
}

// All responses from this route need X-Frame-Options: SAMEORIGIN to allow iframe embedding
const FRAME_HEADERS = { 'X-Frame-Options': 'SAMEORIGIN' };

function jsonResponse(data: object, status: number) {
  return NextResponse.json(data, { status, headers: FRAME_HEADERS });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken, documentId } = await context.params;
    const session = await getViewerSession(shareToken, {
      ...viewerSessionBaseSelect,
      room: {
        select: {
          id: true,
          allowViewerVersionHistory: true,
        },
      },
    });
    const sessionResult = requireViewerSession(shareToken, session);
    if ('response' in sessionResult) {
      return jsonResponse(await sessionResult.response.json(), sessionResult.response.status);
    }
    const viewerSession = sessionResult.session;

    // Check if document is allowed by link scope
    if (
      viewerSession.link.scope === 'DOCUMENT' &&
      viewerSession.link.scopedDocumentId !== documentId
    ) {
      return jsonResponse({ error: 'Document not found' }, 404);
    }

    // Get page number and optional versionId from query params
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const versionId = searchParams.get('versionId') || null;

    // Historical version preview requires the room feature to be enabled
    if (versionId && !viewerSession.room.allowViewerVersionHistory) {
      return jsonResponse({ error: 'Version history is not available for this room' }, 403);
    }

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(viewerSession.organizationId, async (tx) => {
      // Verify the document exists and is viewable in this room
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId: viewerSession.room.id,
          status: 'ACTIVE',
          withdrawnAt: null,
        },
        select: { id: true, currentVersionId: true },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Resolve the version to preview. Only servable (CLEAN / SKIPPED) versions
      // are ever previewed; an INFECTED / still-scanning version is never
      // previewed, and the response is identical (404) whether it is scanning or
      // blocked -- viewers are not told which.
      const versionSelect = {
        id: true,
        scanStatus: true,
        previewAssets: {
          where: { assetType: 'RENDER' as const, pageNumber: page },
          select: { storageKey: true, mimeType: true },
        },
      };

      let version;
      if (versionId) {
        // Explicit historical version (already gated on room feature above):
        // load that exact version, servable only.
        version = await tx.documentVersion.findFirst({
          where: {
            id: versionId,
            documentId,
            organizationId: viewerSession.organizationId,
            ...SERVABLE_SCAN_STATUS_FILTER,
          },
          select: versionSelect,
        });
      } else if (document.currentVersionId) {
        // Default: preview the CURRENT version exactly (follows rollback; never
        // silently downgrades to an older version when the current one is not
        // servable).
        const current = await tx.documentVersion.findFirst({
          where: {
            id: document.currentVersionId,
            documentId,
            organizationId: viewerSession.organizationId,
          },
          select: versionSelect,
        });
        version = current && isServable(current.scanStatus) ? current : null;
      } else {
        // Legacy documents without a current pointer: highest servable version.
        version = await tx.documentVersion.findFirst({
          where: {
            documentId,
            organizationId: viewerSession.organizationId,
            ...SERVABLE_SCAN_STATUS_FILTER,
          },
          orderBy: { versionNumber: 'desc' },
          select: versionSelect,
        });
      }

      if (!version) {
        return { error: 'Document version not found', status: 404 };
      }

      return { version };
    });

    if ('error' in result) {
      return jsonResponse({ error: result.error }, result.status || 500);
    }

    const { version: latestVersion } = result;

    const previewAsset = latestVersion.previewAssets[0];
    if (!previewAsset) {
      // Return a placeholder response if no preview is available yet
      return jsonResponse({ error: 'Preview not available', processing: true }, 202);
    }

    // Get storage provider and generate signed URL
    const providers = getProviders();
    const storage = providers.storage;

    const bucket = 'previews';
    const key = previewAsset.storageKey;

    // Check if file exists
    const exists = await storage.exists(bucket, key);
    if (!exists) {
      return jsonResponse({ error: 'Preview file not found', processing: true }, 202);
    }

    // Get the file and return it directly (more reliable than redirect for images)
    const data = await storage.get(bucket, key);
    const mimeType = previewAsset.mimeType || 'image/png';

    // X-Frame-Options: SAMEORIGIN allows iframe embedding within same origin for preview dialogs
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': data.length.toString(),
        'Cache-Control': 'private, max-age=300', // 5 minute cache
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    console.error('[ViewerPreviewAPI] Error:', error);
    return jsonResponse({ error: 'Failed to get preview' }, 500);
  }
}
