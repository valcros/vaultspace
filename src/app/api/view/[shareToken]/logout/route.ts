/**
 * Viewer Logout API
 *
 * POST /api/view/[shareToken]/logout - End viewer session
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { withOrgContext } from '@/lib/db';
import { getViewerSession, viewerSessionBaseSelect } from '@/lib/viewerSession';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;
    const cookieStore = await cookies();
    const session = await getViewerSession(shareToken, viewerSessionBaseSelect);

    if (session?.link?.slug === shareToken) {
      await withOrgContext(session.organizationId, async (tx) => {
        await tx.viewSession.delete({
          where: { id: session.id },
        });
      });
    }

    cookieStore.delete(`viewer_${shareToken}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ViewerLogoutAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to logout' }, { status: 500 });
  }
}
