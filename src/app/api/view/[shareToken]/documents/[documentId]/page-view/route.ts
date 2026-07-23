/**
 * Viewer Page View Recording API (F026)
 *
 * POST /api/view/[shareToken]/documents/[documentId]/page-view - Record a page view
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { withOrgContext } from '@/lib/db';
import {
  getViewerSession,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';
import { canViewerLinkAccessDocument } from '@/lib/viewerLinkScope';

interface RouteContext {
  params: Promise<{ shareToken: string; documentId: string }>;
}

const pageViewSchema = z.object({
  pageNumber: z.number().int().min(1).max(10_000),
  timeSpentMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000),
});

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

    const parsedBody = pageViewSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid page-view data' }, { status: 400 });
    }
    const { pageNumber, timeSpentMs } = parsedBody.data;

    const recorded = await withOrgContext(viewerSession.organizationId, async (tx) => {
      // Verify document exists in this room
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId: viewerSession.room.id,
          organizationId: viewerSession.organizationId,
          status: 'ACTIVE',
          withdrawnAt: null,
        },
        select: { id: true, folderId: true, currentVersionId: true },
      });

      if (!document) {
        return false;
      }

      const allowed = await canViewerLinkAccessDocument(
        tx,
        viewerSession.link,
        viewerSession.room.id,
        document
      );
      if (!allowed) {
        return false;
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

      return true;
    });

    if (!recorded) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PageViewAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to record page view' }, { status: 500 });
  }
}
