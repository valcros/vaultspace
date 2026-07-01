/**
 * Scheduled Reports / Weekly Digest API (F030)
 *
 * GET  /api/rooms/:roomId/reports/digest - Generate a digest report for a room
 * POST /api/rooms/:roomId/reports/digest - Trigger sending the digest email
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { hasCapability, createCapabilityUnavailableResponse } from '@/lib/deployment-capabilities';
import { JOB_NAMES, QUEUE_NAMES } from '@/workers/types';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

const digestPeriodSchema = z.enum(['daily', 'weekly', 'monthly']);

const digestQuerySchema = z.object({
  period: digestPeriodSchema.default('weekly'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

type DigestPeriod = z.infer<typeof digestPeriodSchema>;
type OrgTx = Prisma.TransactionClient;

interface DigestReport {
  period: DigestPeriod;
  from: string;
  to: string;
  room: { id: string; name: string };
  summary: {
    documentsUploaded: number;
    documentsViewed: number;
    documentsDownloaded: number;
    uniqueViewers: number;
    questionsSubmitted: number;
    questionsAnswered: number;
    newShareLinks: number;
  };
  topDocuments: Array<{ name: string; views: number; downloads: number }>;
  recentQuestions: Array<{ subject: string; status: string; askedByEmail: string | null }>;
  viewerActivity: Array<{ email: string; views: number; lastActive: string }>;
}

interface DigestRecipient {
  email: string;
  name: string;
}

interface DigestRecipientUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
}

function isQaSmokeDigestRecipient(email: string): boolean {
  if (process.env['DIGEST_INCLUDE_QA_SMOKE_RECIPIENTS'] === 'true') {
    return false;
  }

  const localPart = email.trim().toLowerCase().split('@')[0] ?? '';
  return localPart.includes('+vaultspace-qa-');
}

/**
 * Compute default date range based on period.
 */
function getDefaultDateRange(period: DigestPeriod, from?: string, to?: string) {
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

async function buildDigestReport(
  tx: OrgTx,
  organizationId: string,
  roomId: string,
  period: DigestPeriod,
  fromDate: Date,
  toDate: Date
): Promise<DigestReport | { error: string; status: number }> {
  const room = await tx.room.findFirst({
    where: {
      id: roomId,
      organizationId,
    },
    select: { id: true, name: true },
  });

  if (!room) {
    return { error: 'Room not found', status: 404 };
  }

  const orgRoomFilter = {
    roomId,
    organizationId,
  };

  const dateFilter = {
    createdAt: {
      gte: fromDate,
      lte: toDate,
    },
  };

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
    tx.event.count({
      where: {
        ...orgRoomFilter,
        ...dateFilter,
        eventType: 'DOCUMENT_UPLOADED',
      },
    }),
    tx.event.count({
      where: {
        ...orgRoomFilter,
        ...dateFilter,
        eventType: 'DOCUMENT_VIEWED',
      },
    }),
    tx.event.count({
      where: {
        ...orgRoomFilter,
        ...dateFilter,
        eventType: 'DOCUMENT_DOWNLOADED',
      },
    }),
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
    tx.question.count({
      where: {
        ...orgRoomFilter,
        ...dateFilter,
      },
    }),
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
    tx.link.count({
      where: {
        ...orgRoomFilter,
        ...dateFilter,
      },
    }),
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

  const topDocIds = Array.from(docStats.entries())
    .sort((a, b) => b[1].views + b[1].downloads - (a[1].views + a[1].downloads))
    .slice(0, 10)
    .map(([id]) => id);

  const docNames =
    topDocIds.length > 0
      ? await tx.document.findMany({
          where: {
            id: { in: topDocIds },
            organizationId,
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
}

async function getRoomAdminRecipients(
  tx: OrgTx,
  organizationId: string,
  roomId: string
): Promise<DigestRecipient[]> {
  const [orgAdmins, roomAdmins] = await Promise.all([
    tx.userOrganization.findMany({
      where: {
        organizationId,
        role: 'ADMIN',
        isActive: true,
        user: { isActive: true },
      },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
        },
      },
    }),
    tx.roleAssignment.findMany({
      where: {
        organizationId,
        roomId,
        role: 'ADMIN',
        scopeType: 'ROOM',
        user: { isActive: true },
      },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
        },
      },
    }),
  ]);

  const roomAdminUserIds = roomAdmins.map((assignment) => assignment.user.id);
  const activeRoomAdminMemberships =
    roomAdminUserIds.length > 0
      ? await tx.userOrganization.findMany({
          where: {
            organizationId,
            userId: { in: roomAdminUserIds },
            isActive: true,
            user: { isActive: true },
          },
          select: { userId: true },
        })
      : [];
  const activeRoomAdminIds = new Set(
    activeRoomAdminMemberships.map((membership) => membership.userId)
  );
  const recipients = new Map<string, DigestRecipient>();

  const addRecipient = (user: DigestRecipientUser) => {
    if (!user.isActive || isQaSmokeDigestRecipient(user.email)) {
      return;
    }

    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Admin';
    recipients.set(user.id, { email: user.email, name });
  };

  for (const admin of orgAdmins) {
    addRecipient(admin.user);
  }

  for (const assignment of roomAdmins) {
    if (activeRoomAdminIds.has(assignment.user.id)) {
      addRecipient(assignment.user);
    }
  }

  return Array.from(recipients.values());
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

    const result = await withOrgContext(session.organizationId, async (tx) =>
      buildDigestReport(tx, session.organizationId, roomId, period, fromDate, toDate)
    );

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
    let period: DigestPeriod = 'weekly';
    try {
      const body = await request.json();
      const parsedBody = z.object({ period: digestPeriodSchema.optional() }).safeParse(body);
      if (parsedBody.success && parsedBody.data.period) {
        period = parsedBody.data.period;
      }
    } catch {
      // No body or invalid JSON is fine, use default
    }

    const { fromDate, toDate } = getDefaultDateRange(period);

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const digest = await buildDigestReport(
        tx,
        session.organizationId,
        roomId,
        period,
        fromDate,
        toDate
      );
      if ('error' in digest) {
        return digest;
      }

      const recipients = await getRoomAdminRecipients(tx, session.organizationId, roomId);
      return { digest, recipients };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.recipients.length === 0) {
      return NextResponse.json(
        {
          message: 'Digest email skipped because no room admins were found',
          jobIds: [],
          recipientCount: 0,
        },
        { status: 202 }
      );
    }

    const providers = getProviders();
    const appUrl = process.env['APP_URL'];
    const roomUrl = appUrl ? `${appUrl}/rooms/${roomId}` : undefined;
    const jobIds = await Promise.all(
      result.recipients.map((recipient) =>
        providers.job.addJob(QUEUE_NAMES.NORMAL, JOB_NAMES.EMAIL_SEND, {
          to: recipient.email,
          subject: `${period.charAt(0).toUpperCase() + period.slice(1)} digest: ${
            result.digest.room.name
          }`,
          template: 'room-digest',
          data: {
            ...result.digest,
            recipientName: recipient.name,
            roomName: result.digest.room.name,
            roomUrl,
          },
        })
      )
    );

    return NextResponse.json(
      {
        message: 'Digest email queued',
        jobIds,
        recipientCount: result.recipients.length,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[DigestAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to queue digest email' }, { status: 500 });
  }
}
