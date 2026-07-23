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

const PERIOD_DAYS = 30;

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - PERIOD_DAYS);

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: roomId, organizationId: session.organizationId },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      const orgRoomFilter = { roomId, organizationId: session.organizationId };

      const [
        totalDocuments,
        documentCounters,
        capturedViews,
        capturedDownloads,
        uniqueViewerRecords,
        topDocuments,
        recentViewerSessions,
        recentEvents,
        viewEvents,
        organization,
      ] = await Promise.all([
        tx.document.count({
          where: { ...orgRoomFilter, status: 'ACTIVE', deletedAt: null },
        }),

        tx.document.aggregate({
          where: { ...orgRoomFilter, status: 'ACTIVE', deletedAt: null },
          _sum: { viewCount: true, downloadCount: true },
        }),

        tx.event.count({
          where: { ...orgRoomFilter, eventType: 'DOCUMENT_VIEWED' },
        }),

        tx.event.count({
          where: { ...orgRoomFilter, eventType: 'DOCUMENT_DOWNLOADED' },
        }),

        tx.viewSession.findMany({
          where: {
            ...orgRoomFilter,
            visitorEmail: { not: null },
          },
          select: { visitorEmail: true },
          distinct: ['visitorEmail'],
        }),

        tx.document.findMany({
          where: { ...orgRoomFilter, status: 'ACTIVE', deletedAt: null },
          select: {
            id: true,
            name: true,
            viewCount: true,
            downloadCount: true,
            lastViewedAt: true,
            createdAt: true,
          },
          orderBy: { viewCount: 'desc' },
          take: 10,
        }),

        tx.viewSession.findMany({
          where: { ...orgRoomFilter },
          select: {
            visitorEmail: true,
            visitorName: true,
            totalTimeSpentSeconds: true,
            lastActivityAt: true,
          },
          orderBy: { lastActivityAt: 'desc' },
          take: 10,
        }),

        tx.event.findMany({
          where: { ...orgRoomFilter, createdAt: { gte: periodStart } },
          select: {
            id: true,
            eventType: true,
            description: true,
            actorEmail: true,
            actor: { select: { firstName: true, lastName: true, email: true } },
            metadata: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),

        // Daily view counts aggregated in the database; fetching every event
        // row to bucket in JS scaled with event volume, not with PERIOD_DAYS.
        tx.$queryRaw<{ day: Date; views: bigint }[]>`
          SELECT date_trunc('day', "createdAt") AS day, count(*)::bigint AS views
          FROM "events"
          WHERE "organizationId" = ${session.organizationId}
            AND "roomId" = ${roomId}
            AND "eventType" = 'DOCUMENT_VIEWED'
            AND "createdAt" >= ${periodStart}
          GROUP BY 1
        `,

        tx.organization.findUnique({
          where: { id: session.organizationId },
          select: { auditCaptureMode: true },
        }),
      ]);

      // Build daily view timeline over the period
      const dayCountMap = new Map<string, number>();
      for (let i = 0; i < PERIOD_DAYS; i++) {
        const d = new Date(periodStart);
        d.setDate(d.getDate() + i);
        dayCountMap.set(d.toISOString().slice(0, 10), 0);
      }
      for (const bucket of viewEvents) {
        const key = bucket.day.toISOString().slice(0, 10);
        dayCountMap.set(key, (dayCountMap.get(key) ?? 0) + Number(bucket.views));
      }
      const viewTimeline = Array.from(dayCountMap.entries()).map(([date, count]) => ({
        date,
        count,
      }));

      return {
        summary: {
          totalDocuments,
          totalViews: documentCounters._sum.viewCount ?? 0,
          uniqueViewers: uniqueViewerRecords.length,
          totalDownloads: documentCounters._sum.downloadCount ?? 0,
        },
        auditReconciliation: {
          captureMode: organization?.auditCaptureMode ?? 'OFF',
          operationalViewCount: documentCounters._sum.viewCount ?? 0,
          capturedViewEvents: capturedViews,
          operationalDownloadCount: documentCounters._sum.downloadCount ?? 0,
          capturedDownloadEvents: capturedDownloads,
          viewDelta: (documentCounters._sum.viewCount ?? 0) - capturedViews,
          downloadDelta: (documentCounters._sum.downloadCount ?? 0) - capturedDownloads,
          interpretation:
            'Operational counters include historical and repeated activity. Audit events begin when capture is enabled and may be deduplicated.',
        },
        topDocuments: topDocuments.map((doc) => ({
          id: doc.id,
          name: doc.name,
          viewCount: doc.viewCount,
          downloadCount: doc.downloadCount,
          lastViewedAt: doc.lastViewedAt?.toISOString() ?? null,
          createdAt: doc.createdAt.toISOString(),
        })),
        recentViewers: recentViewerSessions.map((s) => ({
          email: s.visitorEmail,
          name: s.visitorName,
          identityLabel: s.visitorEmail ? 'Asserted email' : 'Anonymous viewer',
          timeSpent: s.totalTimeSpentSeconds,
          lastActive: s.lastActivityAt.toISOString(),
        })),
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          type: e.eventType,
          description: e.description,
          actor: e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : (e.actorEmail ?? 'System'),
          identityLabel: e.actor ? 'Account identity' : e.actorEmail ? 'Asserted email' : 'System',
          auditStatus:
            e.metadata &&
            typeof e.metadata === 'object' &&
            !Array.isArray(e.metadata) &&
            (e.metadata as Record<string, unknown>)['authoritative'] === false
              ? 'shadow'
              : 'authoritative',
          createdAt: e.createdAt.toISOString(),
        })),
        viewTimeline,
        period: {
          days: PERIOD_DAYS,
          startDate: periodStart.toISOString(),
        },
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
