/**
 * Room Analytics Summary API (F028)
 *
 * GET /api/rooms/:roomId/analytics - Get room-level analytics summary
 *
 * Viewer analytics merge BOTH sources of room access:
 *   - authenticated-member DOCUMENT_VIEWED events (no ViewSession is created for
 *     members), and
 *   - share-link viewer ViewSessions.
 * A "unique viewer" is keyed by normalized email (falling back to account id),
 * so the same person is counted once even when they appear as a member event,
 * as a share-link session, and as that session's own DOCUMENT_VIEWED events
 * (which carry actorEmail = visitorEmail). Operational counters
 * (Document.viewCount/downloadCount) remain a SEPARATE metric, reconciled
 * against the deduplicated captured access events.
 *
 * Scope note: this fix covers the room-analytics unique/recent viewers and the
 * operational-vs-captured reconciliation. The heatmap, per-document, and
 * per-page viewer keyings remain inconsistent and are tracked as follow-ups.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

const PERIOD_DAYS = 30;
const RECENT_VIEWERS_LIMIT = 10;

type Provenance = 'native' | 'legacy' | 'inferred';
type AuditStatus = 'authoritative' | 'shadow' | 'inferred';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

function normalizeEmail(email?: string | null): string | null {
  const normalized = email?.toLowerCase().trim();
  return normalized ? normalized : null;
}

/**
 * Stable identity key for de-duplicating a viewer across the member-event and
 * share-link-session sources. Email-primary so a share-link viewer's session and
 * their own DOCUMENT_VIEWED events (actorEmail = visitorEmail) collapse to one,
 * and so a member who also used a share link with the same email counts once.
 * Returns null for anonymous access (no email, no account) which is not counted
 * as a unique identified viewer.
 */
function viewerKey(email?: string | null, id?: string | null): string | null {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    return `email:${normalizedEmail}`;
  }
  if (id) {
    return `user:${id}`;
  }
  return null;
}

function provenanceRank(provenance: Provenance): number {
  return provenance === 'native' ? 3 : provenance === 'legacy' ? 2 : 1;
}

function readEventProvenance(metadata: unknown): {
  provenance: Provenance;
  auditStatus: AuditStatus;
} {
  const meta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const provenance: Provenance = meta['source'] === 'native' ? 'native' : 'legacy';
  const auditStatus: AuditStatus = meta['authoritative'] === false ? 'shadow' : 'authoritative';
  return { provenance, auditStatus };
}

interface RecentViewerAgg {
  email: string | null;
  name: string | null;
  identityLabel: 'Account identity' | 'Asserted email' | 'Anonymous viewer';
  accessType: 'member' | 'share-link';
  provenance: Provenance;
  auditStatus: AuditStatus;
  timeSpent: number | null;
  lastActive: Date;
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
        memberViewerGroups,
        linkViewerGroups,
        topDocuments,
        recentViewEvents,
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

        // Distinct authenticated-member (and share-link) viewer identities from
        // captured DOCUMENT_VIEWED events, all-time. groupBy keeps this an
        // aggregate rather than transferring every event row.
        tx.event.groupBy({
          by: ['actorId', 'actorEmail'],
          where: { ...orgRoomFilter, eventType: 'DOCUMENT_VIEWED' },
        }),

        // Distinct share-link viewer identities from view sessions, all-time.
        tx.viewSession.groupBy({
          by: ['userId', 'visitorEmail'],
          where: { ...orgRoomFilter },
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

        // Recent captured document-view events (with provenance metadata) feed
        // the merged recent-viewers list alongside share-link sessions. These are
        // member views (actorId present) and share-link viewer views (actorId
        // null, actorEmail = visitorEmail).
        tx.event.findMany({
          where: {
            ...orgRoomFilter,
            eventType: 'DOCUMENT_VIEWED',
            createdAt: { gte: periodStart },
          },
          select: {
            id: true,
            actorId: true,
            actorEmail: true,
            metadata: true,
            createdAt: true,
            actor: { select: { firstName: true, lastName: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),

        tx.viewSession.findMany({
          where: { ...orgRoomFilter },
          select: {
            id: true,
            userId: true,
            visitorEmail: true,
            visitorName: true,
            totalTimeSpentSeconds: true,
            lastActivityAt: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
          orderBy: { lastActivityAt: 'desc' },
          take: RECENT_VIEWERS_LIMIT,
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

      // Resolve member emails from actorId so an actor-ID-only DOCUMENT_VIEWED
      // event (actorEmail null) still collapses with the same person's
      // email-keyed share-link session. The account-id fallback (in viewerKey)
      // only applies when no email is resolvable at all.
      const memberActorIds = memberViewerGroups
        .map((group) => group.actorId)
        .filter((id): id is string => Boolean(id));
      const actorEmailById = new Map<string, string>();
      if (memberActorIds.length > 0) {
        const actors = await tx.user.findMany({
          where: { id: { in: memberActorIds } },
          select: { id: true, email: true },
        });
        for (const actor of actors) {
          if (actor.email) {
            actorEmailById.set(actor.id, actor.email);
          }
        }
      }

      // Merge member-event and share-link-session identities into one distinct
      // (all-time) unique-viewer set. Anonymous access (no key) is not counted.
      const uniqueViewerKeys = new Set<string>();
      for (const group of memberViewerGroups) {
        const resolvedEmail =
          group.actorEmail ?? (group.actorId ? (actorEmailById.get(group.actorId) ?? null) : null);
        const key = viewerKey(resolvedEmail, group.actorId);
        if (key) {
          uniqueViewerKeys.add(key);
        }
      }
      for (const group of linkViewerGroups) {
        const key = viewerKey(group.visitorEmail, group.userId);
        if (key) {
          uniqueViewerKeys.add(key);
        }
      }
      const uniqueViewers = uniqueViewerKeys.size;

      // Build the merged, de-duplicated recent-viewers list. Provenance is the
      // highest-precedence source seen for a viewer (native > legacy > inferred).
      const recentMap = new Map<string, RecentViewerAgg>();
      const mergeRecent = (fallbackKey: string, candidate: RecentViewerAgg) => {
        const existing = recentMap.get(fallbackKey);
        if (!existing) {
          recentMap.set(fallbackKey, candidate);
          return;
        }
        if (candidate.lastActive > existing.lastActive) {
          existing.lastActive = candidate.lastActive;
        }
        if (provenanceRank(candidate.provenance) > provenanceRank(existing.provenance)) {
          existing.provenance = candidate.provenance;
          existing.auditStatus = candidate.auditStatus;
        }
        // Prefer an account identity + real name once we have one.
        if (candidate.accessType === 'member') {
          existing.accessType = 'member';
        }
        if (!existing.email && candidate.email) {
          existing.email = candidate.email;
        }
        if (!existing.name && candidate.name) {
          existing.name = candidate.name;
        }
        if (
          existing.identityLabel !== 'Account identity' &&
          candidate.identityLabel === 'Account identity'
        ) {
          existing.identityLabel = 'Account identity';
        }
        if (existing.timeSpent === null && candidate.timeSpent !== null) {
          existing.timeSpent = candidate.timeSpent;
        }
      };

      for (const view of recentViewEvents) {
        const email = normalizeEmail(view.actorEmail ?? view.actor?.email ?? null);
        const key = viewerKey(email, view.actorId);
        const { provenance, auditStatus } = readEventProvenance(view.metadata);
        mergeRecent(key ?? `anon:view-${view.id}`, {
          email,
          name: view.actor ? `${view.actor.firstName} ${view.actor.lastName}` : null,
          identityLabel: view.actor
            ? 'Account identity'
            : email
              ? 'Asserted email'
              : 'Anonymous viewer',
          // Member views carry an accountId; share-link viewer views do not.
          accessType: view.actorId ? 'member' : 'share-link',
          provenance,
          auditStatus,
          timeSpent: null,
          lastActive: view.createdAt,
        });
      }

      for (const viewerSession of recentViewerSessions) {
        const email = normalizeEmail(
          viewerSession.visitorEmail ?? viewerSession.user?.email ?? null
        );
        const key = viewerKey(email, viewerSession.userId);
        const name =
          viewerSession.visitorName ??
          (viewerSession.user
            ? `${viewerSession.user.firstName} ${viewerSession.user.lastName}`
            : null);
        mergeRecent(key ?? `anon:session-${viewerSession.id}`, {
          email,
          name,
          identityLabel: viewerSession.user
            ? 'Account identity'
            : email
              ? 'Asserted email'
              : 'Anonymous viewer',
          accessType: 'share-link',
          provenance: 'inferred',
          auditStatus: 'inferred',
          timeSpent: viewerSession.totalTimeSpentSeconds,
          lastActive: viewerSession.lastActivityAt,
        });
      }

      const recentViewers = Array.from(recentMap.values())
        .sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime())
        .slice(0, RECENT_VIEWERS_LIMIT)
        .map((viewer) => ({
          email: viewer.email,
          name: viewer.name,
          identityLabel: viewer.identityLabel,
          accessType: viewer.accessType,
          provenance: viewer.provenance,
          auditStatus: viewer.auditStatus,
          timeSpent: viewer.timeSpent,
          lastActive: viewer.lastActive.toISOString(),
        }));

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

      const operationalViewCount = documentCounters._sum.viewCount ?? 0;
      const operationalDownloadCount = documentCounters._sum.downloadCount ?? 0;

      return {
        summary: {
          totalDocuments,
          // Operational counter (repeated/preview activity included).
          totalViews: operationalViewCount,
          // Distinct identified viewers: members (DOCUMENT_VIEWED events) merged
          // with share-link sessions, de-duplicated. All-time.
          uniqueViewers,
          totalDownloads: operationalDownloadCount,
        },
        auditReconciliation: {
          captureMode: organization?.auditCaptureMode ?? 'OFF',
          // Operational counters are a SEPARATE metric from captured access events.
          operationalViewCount,
          capturedViewEvents: capturedViews,
          operationalDownloadCount,
          capturedDownloadEvents: capturedDownloads,
          viewDelta: operationalViewCount - capturedViews,
          downloadDelta: operationalDownloadCount - capturedDownloads,
          // Distinct identified viewers derived from the deduplicated merge.
          distinctViewers: uniqueViewers,
          interpretation:
            'Operational counters (Document.viewCount / downloadCount) are a separate metric that includes historical, repeated, and preview activity. Distinct viewers merges deduplicated authenticated-member access events with share-link viewer sessions. Captured audit events begin when capture is enabled and are deduplicated at capture time.',
        },
        topDocuments: topDocuments.map((doc) => ({
          id: doc.id,
          name: doc.name,
          viewCount: doc.viewCount,
          downloadCount: doc.downloadCount,
          lastViewedAt: doc.lastViewedAt?.toISOString() ?? null,
          createdAt: doc.createdAt.toISOString(),
        })),
        recentViewers,
        recentEvents: recentEvents.map((e) => {
          const { auditStatus } = readEventProvenance(e.metadata);
          return {
            id: e.id,
            type: e.eventType,
            description: e.description,
            actor: e.actor
              ? `${e.actor.firstName} ${e.actor.lastName}`
              : (e.actorEmail ?? 'System'),
            identityLabel: e.actor
              ? 'Account identity'
              : e.actorEmail
                ? 'Asserted email'
                : 'System',
            auditStatus,
            createdAt: e.createdAt.toISOString(),
          };
        }),
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
