/**
 * Scheduled Reports / Weekly Digest API (F030)
 *
 * GET  /api/rooms/:roomId/reports/digest - Generate a digest report for a room
 * POST /api/rooms/:roomId/reports/digest - Trigger sending the digest email
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { hasCapability, createCapabilityUnavailableResponse } from '@/lib/deployment-capabilities';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

const digestQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * Compute default date range based on period.
 */
function getDefaultDateRange(period: 'daily' | 'weekly' | 'monthly', from?: string, to?: string) {
  const toDate = to ? new Date(to) : new Date();
  let fromDate: Date;

  if (from) {
    fromDate = new Date(from);
  } else {
    fromDate = new Date(toDate);
    switch (period) {
      case 'daily':
        fromDate.setDate(fromDate.getDate() - 1);
        break;
      case 'weekly':
        fromDate.setDate(fromDate.getDate() - 7);
        break;
      case 'monthly':
        fromDate.setMonth(fromDate.getMonth() - 1);
        break;
    }
  }

  return { fromDate, toDate };
}

/**
 * GET /api/rooms/:roomId/reports/digest
 * Generate a digest report for a room over a period.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse query params
    const url = new URL(request.url);
    const parsed = digestQuerySchema.safeParse({
      period: url.searchParams.get('period') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { period, from, to } = parsed.data;
    const { fromDate, toDate } = getDefaultDateRange(period, from, to);

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        select: { id: true, name: true },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      const orgRoomFilter = {
        roomId,
        organizationId: session.organizationId,
      };

      const dateFilter = {
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      };

      // Gather all data in parallel
      const [
        documentsUploaded,
        documentsViewed,
        documentsDownloaded,
        uniqueViewerRecords,
        questionsSubmitted,
        questionsAnswered,
        newShareLinks,
        topDocumentEvents,
        recentQuestions,
        viewerSessions,
      ] = await Promise.all([
        // Documents uploaded in period
        tx.event.count({
          where: {
            ...orgRoomFilter,
            ...dateFilter,
            eventType: 'DOCUMENT_UPLOADED',
          },
        }),

        // Documents viewed in period
        tx.event.count({
          where: {
            ...orgRoomFilter,
            ...dateFilter,
            eventType: 'DOCUMENT_VIEWED',
          },
        }),

        // Documents downloaded in period
        tx.event.count({
          where: {
            ...orgRoomFilter,
            ...dateFilter,
            eventType: 'DOCUMENT_DOWNLOADED',
          },
        }),

        // Unique viewers (distinct actorEmail from view events)
        tx.event.findMany({
          where: {
            ...orgRoomFilter,
            ...dateFilter,
            eventType: { in: ['DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED'] },
            actorEmail: { not: null },
          },
          select: { actorEmail: true },
          distinct: ['actorEmail'],
        }),

        // Questions submitted in period
        tx.question.count({
          where: {
            ...orgRoomFilter,
            ...dateFilter,
          },
        }),

        // Questions answered in period (status changed to ANSWERED within date range)
        tx.question.count({
          where: {
            ...orgRoomFilter,
            status: 'ANSWERED',
            updatedAt: {
              gte: fromDate,
              lte: toDate,
            },
          },
        }),

        // New share links created in period
        tx.link.count({
          where: {
            ...orgRoomFilter,
            ...dateFilter,
          },
        }),

        // Top documents by views + downloads (events with documentId)
        tx.event.findMany({
          where: {
            ...orgRoomFilter,
            ...dateFilter,
            eventType: { in: ['DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED'] },
            documentId: { not: null },
          },
          select: {
            documentId: true,
            eventType: true,
          },
        }),

        // Recent questions
        tx.question.findMany({
          where: {
            ...orgRoomFilter,
            ...dateFilter,
          },
          select: {
            subject: true,
            status: true,
            askedByEmail: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),

        // Viewer activity from ViewSession
        tx.viewSession.findMany({
          where: {
            ...orgRoomFilter,
            visitorEmail: { not: null },
            lastActivityAt: {
              gte: fromDate,
              lte: toDate,
            },
          },
          select: {
            visitorEmail: true,
            totalTimeSpentSeconds: true,
            lastActivityAt: true,
          },
        }),
      ]);

      // Aggregate top documents
      const docStats = new Map<string, { views: number; downloads: number }>();
      for (const event of topDocumentEvents) {
        if (!event.documentId) {
          continue;
        }
        const existing = docStats.get(event.documentId) ?? { views: 0, downloads: 0 };
        if (event.eventType === 'DOCUMENT_VIEWED') {
          existing.views += 1;
        } else if (event.eventType === 'DOCUMENT_DOWNLOADED') {
          existing.downloads += 1;
        }
        docStats.set(event.documentId, existing);
      }

      // Get document names for top documents
      const topDocIds = Array.from(docStats.entries())
        .sort((a, b) => b[1].views + b[1].downloads - (a[1].views + a[1].downloads))
        .slice(0, 10)
        .map(([id]) => id);

      const docNames =
        topDocIds.length > 0
          ? await tx.document.findMany({
              where: {
                id: { in: topDocIds },
                organizationId: session.organizationId,
              },
              select: { id: true, name: true },
            })
          : [];

      const docNameMap = new Map(docNames.map((d) => [d.id, d.name]));

      const topDocuments = topDocIds.map((id) => ({
        name: docNameMap.get(id) ?? 'Unknown Document',
        views: docStats.get(id)?.views ?? 0,
        downloads: docStats.get(id)?.downloads ?? 0,
      }));

      // Aggregate viewer activity by email (deduplicate)
      const viewerMap = new Map<string, { views: number; lastActive: Date }>();
      for (const vs of viewerSessions) {
        if (!vs.visitorEmail) {
          continue;
        }
        const existing = viewerMap.get(vs.visitorEmail);
        if (existing) {
          existing.views += 1;
          if (vs.lastActivityAt > existing.lastActive) {
            existing.lastActive = vs.lastActivityAt;
          }
        } else {
          viewerMap.set(vs.visitorEmail, {
            views: 1,
            lastActive: vs.lastActivityAt,
          });
        }
      }

      const viewerActivity = Array.from(viewerMap.entries())
        .map(([email, data]) => ({
          email,
          views: data.views,
          lastActive: data.lastActive.toISOString(),
        }))
        .sort((a, b) => b.views - a.views);

      return {
        period,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        room: { id: room.id, name: room.name },
        summary: {
          documentsUploaded,
          documentsViewed,
          documentsDownloaded,
          uniqueViewers: uniqueViewerRecords.length,
          questionsSubmitted,
          questionsAnswered,
          newShareLinks,
        },
        topDocuments,
        recentQuestions,
        viewerActivity,
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[DigestAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to generate digest report' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/reports/digest
 * Trigger sending the digest email to all room admins.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // Check if scheduled reports capability is available (requires Redis)
    if (!hasCapability('canRunScheduledReports')) {
      return createCapabilityUnavailableResponse('canRunScheduledReports', 'Digest email');
    }

    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse optional period from body
    let period = 'weekly';
    try {
      const body = await request.json();
      if (body.period && ['daily', 'weekly', 'monthly'].includes(body.period)) {
        period = body.period;
      }
    } catch {
      // No body or invalid JSON is fine, use default
    }

    // Verify room exists
    const room = await withOrgContext(session.organizationId, async (tx) => {
      return tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        select: { id: true },
      });
    });

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    // Queue the digest email job
    const jobId = await getProviders().job.addJob('normal', 'send-digest', {
      roomId,
      organizationId: session.organizationId,
      period,
    });

    return NextResponse.json(
      {
        message: 'Digest email queued',
        jobId,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[DigestAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to queue digest email' }, { status: 500 });
  }
}
