/**
 * Activity Heatmap API (F028)
 *
 * GET /api/rooms/:roomId/analytics/heatmap - Get viewer activity data for heatmap visualization
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

type PeriodType = 'day' | 'week' | 'month';

const PERIOD_DAYS: Record<PeriodType, number> = {
  day: 1,
  week: 7,
  month: 30,
};

function isValidPeriod(value: string): value is PeriodType {
  return value === 'day' || value === 'week' || value === 'month';
}

interface HourlyRow {
  hour: number;
  count: bigint;
}

/**
 * GET /api/rooms/:roomId/analytics/heatmap
 * Returns activity data aggregated by hour of day and by document.
 *
 * Query params:
 * - period: "day" | "week" | "month" (default: "week")
 * - from: ISO date string (optional)
 * - to: ISO date string (optional)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') ?? 'week';
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    const period: PeriodType = isValidPeriod(periodParam) ? periodParam : 'week';

    const now = new Date();
    const toDate = toParam ? new Date(toParam) : now;
    const fromDate = fromParam
      ? new Date(fromParam)
      : new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);

    // Validate date range
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

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

      const dateFilter = {
        roomId,
        organizationId: session.organizationId,
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      };

      // 1. Hourly activity — raw query for EXTRACT(HOUR FROM ...)
      const hourlyRows = await tx.$queryRaw<HourlyRow[]>`
        SELECT EXTRACT(HOUR FROM "createdAt")::int AS "hour", COUNT(*)::bigint AS "count"
        FROM events
        WHERE "organizationId" = ${session.organizationId}
          AND "roomId" = ${roomId}
          AND "createdAt" >= ${fromDate}
          AND "createdAt" <= ${toDate}
        GROUP BY EXTRACT(HOUR FROM "createdAt")
        ORDER BY "hour"
      `;

      // 2. Document activity — get view/download events grouped by document
      const [viewEvents, downloadEvents, allEvents] = await Promise.all([
        // View events grouped by document
        tx.event.groupBy({
          by: ['documentId'],
          where: {
            ...dateFilter,
            eventType: 'DOCUMENT_VIEWED',
            documentId: { not: null },
          },
          _count: true,
        }),

        // Download events grouped by document
        tx.event.groupBy({
          by: ['documentId'],
          where: {
            ...dateFilter,
            eventType: 'DOCUMENT_DOWNLOADED',
            documentId: { not: null },
          },
          _count: true,
        }),

        // All events in date range for summary
        tx.event.count({
          where: dateFilter,
        }),
      ]);

      // Collect all document IDs referenced in view/download events
      const documentIds = new Set<string>();
      for (const row of viewEvents) {
        if (row.documentId) {
          documentIds.add(row.documentId);
        }
      }
      for (const row of downloadEvents) {
        if (row.documentId) {
          documentIds.add(row.documentId);
        }
      }

      // Fetch document names
      const documents =
        documentIds.size > 0
          ? await tx.document.findMany({
              where: {
                id: { in: Array.from(documentIds) },
                organizationId: session.organizationId,
              },
              select: {
                id: true,
                name: true,
                lastViewedAt: true,
              },
            })
          : [];

      const docNameMap = new Map(documents.map((d) => [d.id, d]));

      // Get unique viewers per document from events
      const viewerEvents =
        documentIds.size > 0
          ? await tx.event.findMany({
              where: {
                ...dateFilter,
                eventType: { in: ['DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED'] },
                documentId: { in: Array.from(documentIds) },
              },
              select: {
                documentId: true,
                actorEmail: true,
                metadata: true,
              },
            })
          : [];

      // Aggregate unique viewers per document
      const docViewerMap = new Map<string, Set<string>>();
      for (const ev of viewerEvents) {
        if (!ev.documentId) {
          continue;
        }
        if (!docViewerMap.has(ev.documentId)) {
          docViewerMap.set(ev.documentId, new Set());
        }
        const viewers = docViewerMap.get(ev.documentId)!;
        // Check actorEmail first, then metadata.viewerEmail
        const email =
          ev.actorEmail ??
          (ev.metadata && typeof ev.metadata === 'object' && 'viewerEmail' in ev.metadata
            ? String((ev.metadata as Record<string, unknown>)['viewerEmail'])
            : null);
        if (email) {
          viewers.add(email);
        }
      }

      // Build view/download count maps
      const viewCountMap = new Map<string, number>();
      for (const row of viewEvents) {
        if (row.documentId) {
          viewCountMap.set(row.documentId, row._count);
        }
      }

      const downloadCountMap = new Map<string, number>();
      for (const row of downloadEvents) {
        if (row.documentId) {
          downloadCountMap.set(row.documentId, row._count);
        }
      }

      // Build document activity array
      const documentActivity = Array.from(documentIds)
        .map((docId) => {
          const doc = docNameMap.get(docId);
          return {
            documentId: docId,
            documentName: doc?.name ?? 'Unknown',
            totalViews: viewCountMap.get(docId) ?? 0,
            totalDownloads: downloadCountMap.get(docId) ?? 0,
            uniqueViewers: docViewerMap.get(docId)?.size ?? 0,
            lastViewedAt: doc?.lastViewedAt?.toISOString() ?? null,
          };
        })
        .sort((a, b) => b.totalViews - a.totalViews);

      // Get overall unique viewers
      const allViewerEmails = new Set<string>();
      for (const ev of viewerEvents) {
        const email =
          ev.actorEmail ??
          (ev.metadata && typeof ev.metadata === 'object' && 'viewerEmail' in ev.metadata
            ? String((ev.metadata as Record<string, unknown>)['viewerEmail'])
            : null);
        if (email) {
          allViewerEmails.add(email);
        }
      }

      return {
        hourlyRows,
        documentActivity,
        totalEvents: allEvents,
        uniqueViewers: allViewerEmails.size,
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Build hourly activity array with all 24 hours
    const hourlyMap = new Map<number, number>();
    for (const row of result.hourlyRows) {
      hourlyMap.set(Number(row.hour), Number(row.count));
    }

    const hourlyActivity = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: hourlyMap.get(i) ?? 0,
    }));

    // Find peak hour
    let peakHour = 0;
    let peakCount = 0;
    for (const entry of hourlyActivity) {
      if (entry.count > peakCount) {
        peakCount = entry.count;
        peakHour = entry.hour;
      }
    }

    // Find most viewed document
    const mostViewedDoc =
      result.documentActivity.length > 0 ? result.documentActivity[0]!.documentName : '';

    return NextResponse.json({
      hourlyActivity,
      documentActivity: result.documentActivity,
      summary: {
        totalEvents: result.totalEvents,
        uniqueViewers: result.uniqueViewers,
        peakHour,
        mostViewedDocument: mostViewedDoc,
      },
      period: {
        type: period,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
    });
  } catch (error) {
    console.error('[HeatmapAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get heatmap data' }, { status: 500 });
  }
}
