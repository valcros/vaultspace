/**
 * Organization Stats API
 *
 * GET /api/organization/stats - Get aggregate metrics for dashboard
 */

import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();

    const stats = await withOrgContext(session.organizationId, async (tx) => {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const [totalRooms, totalDocuments, totalMembers, viewsThisWeek] = await Promise.all([
        tx.room.count({
          where: { organizationId: session.organizationId, status: { not: 'CLOSED' } },
        }),
        tx.document.count({
          where: { organizationId: session.organizationId, status: 'ACTIVE' },
        }),
        tx.userOrganization.count({
          where: { organizationId: session.organizationId, isActive: true },
        }),
        tx.event.count({
          where: {
            organizationId: session.organizationId,
            eventType: 'DOCUMENT_VIEWED',
            createdAt: { gte: oneWeekAgo },
          },
        }),
      ]);

      return { totalRooms, totalDocuments, totalMembers, viewsThisWeek };
    });

    return NextResponse.json(stats);
  } catch (error) {
    console.error('[StatsAPI] Error:', error);
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}
