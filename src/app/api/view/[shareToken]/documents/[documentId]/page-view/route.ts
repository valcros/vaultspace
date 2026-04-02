/**
 * Viewer Page View Recording API (F026)
 *
 * POST /api/view/[shareToken]/documents/[documentId]/page-view - Record a page view
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db, withOrgContext } from '@/lib/db';

interface RouteContext {
  params: Promise<{ shareToken: string; documentId: string }>;
}

/**
 * PRE-RLS BOOTSTRAP: Resolve viewer session from token
 */
async function getViewerSession(shareToken: string) {
  const cookieStore = await cookies();
  const viewerToken = cookieStore.get(`viewer_${shareToken}`)?.value;

  if (!viewerToken) {
    return null;
  }

  const session = await db.viewSession.findFirst({
    where: {
      sessionToken: viewerToken,
    },
    select: {
      id: true,
      organizationId: true,
      visitorEmail: true,
      room: {
        select: {
          id: true,
        },
      },
    },
  });

  return session;
}

/**
 * POST /api/view/[shareToken]/documents/[documentId]/page-view
 * Records a page view. Upserts by document+viewer+page.
 * Body: { pageNumber: number, timeSpentMs: number }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken, documentId } = await context.params;
    const session = await getViewerSession(shareToken);

    if (!session) {
      return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 });
    }

    const body = await request.json();
    const { pageNumber, timeSpentMs } = body;

    // Validate input
    if (typeof pageNumber !== 'number' || pageNumber < 1) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
    }

    if (typeof timeSpentMs !== 'number' || timeSpentMs < 0) {
      return NextResponse.json({ error: 'Invalid time spent' }, { status: 400 });
    }

    await withOrgContext(session.organizationId, async (tx) => {
      // Verify document exists in this room
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId: session.room.id,
          organizationId: session.organizationId,
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
          roomId: session.room.id,
          organizationId: session.organizationId,
          viewerEmail: session.visitorEmail ?? undefined,
          viewSessionId: session.id,
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
            organizationId: session.organizationId,
            documentId,
            versionId: document.currentVersionId,
            roomId: session.room.id,
            viewerEmail: session.visitorEmail,
            viewSessionId: session.id,
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
