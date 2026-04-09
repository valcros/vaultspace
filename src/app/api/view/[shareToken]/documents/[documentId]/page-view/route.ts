/**
 * Viewer Page View Recording API (F026)
 *
 * POST /api/view/[shareToken]/documents/[documentId]/page-view - Record a page view
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

/**
 * POST /api/view/[shareToken]/documents/[documentId]/page-view
 * Records a page view. Upserts by document+viewer+page.
 * Body: { pageNumber: number, timeSpentMs: number }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken, documentId } = await context.params;
    const session = await getViewerSession(shareToken, {
      ...viewerSessionBaseSelect,
      visitorEmail: true,
      room: {
        select: {
          id: true,
        },
      },
    });
    const sessionResult = requireViewerSession(shareToken, session);
    if ('response' in sessionResult) {
      return sessionResult.response;
    }
    const viewerSession = sessionResult.session;

    const body = await request.json();
    const { pageNumber, timeSpentMs } = body;

    // Validate input
    if (typeof pageNumber !== 'number' || pageNumber < 1) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
    }

    if (typeof timeSpentMs !== 'number' || timeSpentMs < 0) {
      return NextResponse.json({ error: 'Invalid time spent' }, { status: 400 });
    }

    await withOrgContext(viewerSession.organizationId, async (tx) => {
      // Verify document exists in this room
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId: viewerSession.room.id,
          organizationId: viewerSession.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true, currentVersionId: true },
      });

      if (!document) {
        return;
      }

      // Try to find existing page view for this viewer+document+page
      const existingView = await tx.pageView.findFirst({
        where: {
          documentId,
          roomId: viewerSession.room.id,
          organizationId: viewerSession.organizationId,
          viewerEmail: viewerSession.visitorEmail ?? undefined,
          viewSessionId: viewerSession.id,
          pageNumber,
        },
        select: { id: true },
      });

      if (existingView) {
        // Update time spent
        await tx.pageView.update({
          where: { id: existingView.id },
          data: {
            timeSpentMs: { increment: timeSpentMs },
          },
        });
      } else {
        // Create new page view
        await tx.pageView.create({
          data: {
            organizationId: viewerSession.organizationId,
            documentId,
            versionId: document.currentVersionId,
            roomId: viewerSession.room.id,
            viewerEmail: viewerSession.visitorEmail,
            viewSessionId: viewerSession.id,
            pageNumber,
            timeSpentMs,
          },
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PageViewAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to record page view' }, { status: 500 });
  }
}
