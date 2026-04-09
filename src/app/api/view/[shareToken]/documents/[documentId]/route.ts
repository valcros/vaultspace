/**
 * Viewer Document API
 *
 * GET /api/view/[shareToken]/documents/[documentId] - Get document details for viewer
 */

import { NextRequest, NextResponse } from 'next/server';

import { withOrgContext } from '@/lib/db';
import {
  getViewerSession,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';

interface RouteContext {
  params: Promise<{ shareToken: string; documentId: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { shareToken, documentId } = await context.params;
    const session = await getViewerSession(shareToken, {
      ...viewerSessionBaseSelect,
      visitorEmail: true,
      visitorName: true,
      ipAddress: true,
      room: {
        select: {
          id: true,
          allowDownloads: true,
          enableWatermark: true,
          watermarkTemplate: true,
        },
      },
    });
    const sessionResult = requireViewerSession(shareToken, session);
    if ('response' in sessionResult) {
      return sessionResult.response;
    }
    const viewerSession = sessionResult.session;

    // Check if document is allowed by link scope
    if (
      viewerSession.link.scope === 'DOCUMENT' &&
      viewerSession.link.scopedDocumentId !== documentId
    ) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(viewerSession.organizationId, async (tx) => {
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId: viewerSession.room.id,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          mimeType: true,
          allowDownload: true,
          currentVersionId: true,
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: {
              previewAssets: {
                where: { assetType: 'RENDER' },
                select: { pageNumber: true },
              },
            },
          },
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Update view count
      await tx.document.update({
        where: { id: document.id },
        data: {
          viewCount: { increment: 1 },
          lastViewedAt: new Date(),
        },
      });

      return { document };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const document = result.document;

    // Get page count from preview assets
    const pageCount = document.versions[0]?.previewAssets?.length || 1;

    // Generate watermark text only if room has watermarks enabled (F130)
    let watermarkText: string | null = null;
    if (viewerSession.room.enableWatermark && viewerSession.visitorEmail) {
      // Use room's template if configured, otherwise default format
      const template = viewerSession.room.watermarkTemplate || '{{email}} • {{date}}';
      const now = new Date().toISOString();
      watermarkText = template
        .replace('{{email}}', viewerSession.visitorEmail)
        .replace('{{date}}', now.split('T')[0] ?? '')
        .replace('{{time}}', now.split('T')[1]?.slice(0, 5) ?? '')
        .replace('{{ip}}', viewerSession.ipAddress ?? '');
    }

    return NextResponse.json({
      document: {
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        pageCount,
        previewUrl: `/api/view/${shareToken}/documents/${documentId}/preview`,
        downloadEnabled: viewerSession.room.allowDownloads && document.allowDownload,
        watermarkText,
        viewerEmail: viewerSession.visitorEmail ?? null,
        viewerName: viewerSession.visitorName ?? null,
      },
    });
  } catch (error) {
    console.error('[ViewerDocumentAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to load document' }, { status: 500 });
  }
}
