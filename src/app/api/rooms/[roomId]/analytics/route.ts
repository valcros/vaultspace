/**
 * Room Analytics Summary API (F028)
 *
 * GET /api/rooms/:roomId/analytics - Get room-level analytics summary
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * GET /api/rooms/:roomId/analytics
 * Returns overall room analytics summary for admins.
 *
 * Provides:
 * - Total document views
 * - Total downloads
 * - Unique viewers
 * - Average session duration
 * - Most active day (last 30 days)
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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

      const orgRoomFilter = {
        roomId,
        organizationId: session.organizationId,
      };

      const [totalViews, totalDownloads, uniqueViewerRecords, viewSessions, recentEvents] =
        await Promise.all([
          // Total document views (from events)
          tx.event.count({
            where: {
              ...orgRoomFilter,
              eventType: 'DOCUMENT_VIEWED',
            },
          }),

          // Total downloads (from events)
          tx.event.count({
            where: {
              ...orgRoomFilter,
              eventType: 'DOCUMENT_DOWNLOADED',
            },
          }),

          // Unique viewers — distinct actorEmail from view events
          tx.event.findMany({
            where: {
              ...orgRoomFilter,
              eventType: { in: ['DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED'] },
              actorEmail: { not: null },
            },
            select: { actorEmail: true },
            distinct: ['actorEmail'],
          }),

          // View sessions for average duration
          tx.viewSession.aggregate({
            where: orgRoomFilter,
            _avg: {
              totalTimeSpentSeconds: true,
            },
            _count: true,
          }),

          // Events in last 30 days for most active day calculation
          tx.event.findMany({
            where: {
              ...orgRoomFilter,
              createdAt: { gte: thirtyDaysAgo },
            },
            select: {
              createdAt: true,
            },
          }),
        ]);

      // Calculate most active day
      const dayCountMap = new Map<string, number>();
      for (const event of recentEvents) {
        const dateParts = event.createdAt.toISOString().split('T');
        const dateKey = dateParts[0] ?? '';
        if (dateKey) {
          dayCountMap.set(dateKey, (dayCountMap.get(dateKey) ?? 0) + 1);
        }
      }

      let mostActiveDay: string | null = null;
      let mostActiveDayCount = 0;
      dayCountMap.forEach((count, day) => {
        if (count > mostActiveDayCount) {
          mostActiveDayCount = count;
          mostActiveDay = day;
        }
      });

      return {
        totalViews,
        totalDownloads,
        uniqueViewers: uniqueViewerRecords.length,
        averageSessionDurationSeconds: Math.round(viewSessions._avg.totalTimeSpentSeconds ?? 0),
        totalSessions: viewSessions._count,
        mostActiveDay: mostActiveDay
          ? { date: mostActiveDay, eventCount: mostActiveDayCount }
          : null,
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[RoomAnalyticsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get room analytics' }, { status: 500 });
  }
}
