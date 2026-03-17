/**
 * Viewer Logout API
 *
 * POST /api/view/[shareToken]/logout - End viewer session
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db, withOrgContext } from '@/lib/db';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;
    const cookieStore = await cookies();
    const viewerToken = cookieStore.get(`viewer_${shareToken}`)?.value;

    if (viewerToken) {
      // PRE-RLS BOOTSTRAP: Get session to find organizationId
      const session = await db.viewSession.findFirst({
        where: { sessionToken: viewerToken },
        select: { id: true, organizationId: true },
      });

      if (session) {
        // Delete within RLS context
        await withOrgContext(session.organizationId, async (tx) => {
          await tx.viewSession.delete({
            where: { id: session.id },
          });
        });
      }

      // Clear cookie
      cookieStore.delete(`viewer_${shareToken}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ViewerLogoutAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to logout' }, { status: 500 });
  }
}
