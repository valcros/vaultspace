import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db', () => ({ withOrgContext: vi.fn() }));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

function request() {
  return new NextRequest('http://localhost/api/rooms/room-1/analytics');
}

function context() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

interface TxOptions {
  memberGroups?: Array<{ actorId: string | null; actorEmail: string | null }>;
  linkGroups?: Array<{ userId: string | null; visitorEmail: string | null }>;
  memberActors?: Array<{ id: string; email: string | null }>;
  recentViewEvents?: unknown[];
  recentSessions?: unknown[];
  recentEvents?: unknown[];
  docAggregate?: { _sum: { viewCount: number | null; downloadCount: number | null } };
  totalDocuments?: number;
  capturedViews?: number;
  capturedDownloads?: number;
  captureMode?: string;
  topDocuments?: unknown[];
  timeline?: unknown[];
}

function buildTx(opts: TxOptions = {}) {
  const {
    memberGroups = [],
    linkGroups = [],
    memberActors = [],
    recentViewEvents = [],
    recentSessions = [],
    recentEvents = [],
    docAggregate = { _sum: { viewCount: 0, downloadCount: 0 } },
    totalDocuments = 0,
    capturedViews = 0,
    capturedDownloads = 0,
    captureMode = 'OFF',
    topDocuments = [],
    timeline = [],
  } = opts;

  return {
    room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
    document: {
      count: vi.fn().mockResolvedValue(totalDocuments),
      aggregate: vi.fn().mockResolvedValue(docAggregate),
      findMany: vi.fn().mockResolvedValue(topDocuments),
    },
    event: {
      count: vi.fn().mockResolvedValueOnce(capturedViews).mockResolvedValueOnce(capturedDownloads),
      groupBy: vi.fn().mockResolvedValue(memberGroups),
      // First findMany = recent view events; second = recent events feed.
      findMany: vi.fn().mockResolvedValueOnce(recentViewEvents).mockResolvedValueOnce(recentEvents),
    },
    viewSession: {
      groupBy: vi.fn().mockResolvedValue(linkGroups),
      findMany: vi.fn().mockResolvedValue(recentSessions),
    },
    user: {
      findMany: vi.fn().mockResolvedValue(memberActors),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: captureMode }),
    },
    $queryRaw: vi.fn().mockResolvedValue(timeline),
  } as never;
}

function withTx(opts: TxOptions = {}) {
  mockWithOrgContext.mockImplementation(async (_organizationId, callback) =>
    callback(buildTx(opts))
  );
}

async function getBody(opts: TxOptions = {}) {
  withTx(opts);
  const response = await GET(request(), context());
  return { response, body: await response.json() };
}

describe('GET /api/rooms/:roomId/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'admin-1',
      organizationId: 'org-1',
      organization: { role: 'ADMIN' },
    } as Awaited<ReturnType<typeof requireAuth>>);
  });

  it('uses operational counters for headline metrics and reports audit reconciliation separately', async () => {
    const { response, body } = await getBody({
      // A single share-link viewer appears as BOTH a captured DOCUMENT_VIEWED
      // event (actorEmail = visitorEmail) and a view session -> counted once.
      memberGroups: [{ actorId: null, actorEmail: 'viewer@example.com' }],
      linkGroups: [{ userId: null, visitorEmail: 'viewer@example.com' }],
      recentViewEvents: [
        {
          id: 'event-1',
          actorId: null,
          actorEmail: 'viewer@example.com',
          metadata: { source: 'native', authoritative: false },
          createdAt: new Date('2026-07-23T10:00:00Z'),
          actor: null,
        },
      ],
      recentSessions: [
        {
          id: 'session-1',
          userId: null,
          visitorEmail: 'viewer@example.com',
          visitorName: 'Viewer',
          totalTimeSpentSeconds: 60,
          lastActivityAt: new Date('2026-07-23T09:00:00Z'),
          user: null,
        },
      ],
      recentEvents: [
        {
          id: 'event-1',
          eventType: 'DOCUMENT_VIEWED',
          description: 'Share-link viewer opened a document',
          actorEmail: 'viewer@example.com',
          actor: null,
          metadata: { source: 'native', authoritative: false },
          createdAt: new Date('2026-07-23T10:00:00Z'),
        },
      ],
      docAggregate: { _sum: { viewCount: 82, downloadCount: 5 } },
      totalDocuments: 3,
      capturedViews: 4,
      capturedDownloads: 2,
      captureMode: 'SHADOW',
    });

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({
      totalDocuments: 3,
      totalViews: 82,
      uniqueViewers: 1,
      totalDownloads: 5,
    });
    expect(body.auditReconciliation).toEqual(
      expect.objectContaining({
        captureMode: 'SHADOW',
        operationalViewCount: 82,
        capturedViewEvents: 4,
        viewDelta: 78,
        operationalDownloadCount: 5,
        capturedDownloadEvents: 2,
        downloadDelta: 3,
        distinctViewers: 1,
      })
    );
    // Merged into a single recent viewer; native event provenance wins over the
    // inferred session; identity remains the asserted share-link email.
    expect(body.recentViewers).toHaveLength(1);
    expect(body.recentViewers[0]).toEqual(
      expect.objectContaining({
        email: 'viewer@example.com',
        identityLabel: 'Asserted email',
        accessType: 'share-link',
        provenance: 'native',
        auditStatus: 'shadow',
      })
    );
    expect(body.recentEvents[0]).toEqual(
      expect.objectContaining({ identityLabel: 'Asserted email', auditStatus: 'shadow' })
    );
  });

  it('counts a share-link viewer once across their session and multiple view events', async () => {
    // groupBy collapses the viewer's 2+ DOCUMENT_VIEWED events into one identity
    // group; the email key then collapses that with the view session.
    const { body } = await getBody({
      memberGroups: [{ actorId: null, actorEmail: 'guest@example.com' }],
      linkGroups: [{ userId: null, visitorEmail: 'guest@example.com' }],
    });
    expect(body.summary.uniqueViewers).toBe(1);
  });

  it('counts an authenticated member with many views once', async () => {
    const { body } = await getBody({
      memberGroups: [{ actorId: 'user-1', actorEmail: 'member@example.com' }],
      linkGroups: [],
    });
    expect(body.summary.uniqueViewers).toBe(1);
  });

  it('counts a member and a distinct share-link viewer as two', async () => {
    const { body } = await getBody({
      memberGroups: [{ actorId: 'user-1', actorEmail: 'member@example.com' }],
      linkGroups: [{ userId: null, visitorEmail: 'guest@example.com' }],
    });
    expect(body.summary.uniqueViewers).toBe(2);
  });

  it('counts a member who also used a share link with the same email once', async () => {
    const { body } = await getBody({
      memberGroups: [{ actorId: 'user-1', actorEmail: 'shared@example.com' }],
      linkGroups: [{ userId: null, visitorEmail: 'shared@example.com' }],
    });
    expect(body.summary.uniqueViewers).toBe(1);
  });

  it('collapses an actor-ID-only member event with a matching share-link session by resolving the email from actorId', async () => {
    const { body } = await getBody({
      // Member DOCUMENT_VIEWED event has an actorId but NO actorEmail.
      memberGroups: [{ actorId: 'user-9', actorEmail: null }],
      // The member's email is resolvable from their account.
      memberActors: [{ id: 'user-9', email: 'dual@example.com' }],
      // The same person also accessed via a share link with that email.
      linkGroups: [{ userId: null, visitorEmail: 'dual@example.com' }],
      recentViewEvents: [
        {
          id: 'ev-9',
          actorId: 'user-9',
          actorEmail: null,
          metadata: { source: 'native', authoritative: false },
          createdAt: new Date('2026-08-04T12:00:00Z'),
          actor: { firstName: 'Dana', lastName: 'Dual', email: 'dual@example.com' },
        },
      ],
      recentSessions: [
        {
          id: 'sess-9',
          userId: null,
          visitorEmail: 'dual@example.com',
          visitorName: 'Dana Dual',
          totalTimeSpentSeconds: 20,
          lastActivityAt: new Date('2026-08-04T11:00:00Z'),
          user: null,
        },
      ],
    });
    // One distinct viewer and one merged recent-viewer row.
    expect(body.summary.uniqueViewers).toBe(1);
    expect(body.recentViewers).toHaveLength(1);
  });

  it('is case-insensitive when de-duplicating viewer identities', async () => {
    const { body } = await getBody({
      memberGroups: [{ actorId: null, actorEmail: 'Mixed@Example.com' }],
      linkGroups: [{ userId: null, visitorEmail: 'mixed@example.com' }],
    });
    expect(body.summary.uniqueViewers).toBe(1);
  });

  it('merges recent viewers from members and share-link sessions with provenance labels', async () => {
    const { body } = await getBody({
      memberGroups: [{ actorId: 'user-1', actorEmail: 'member@example.com' }],
      linkGroups: [{ userId: null, visitorEmail: 'guest@example.com' }],
      recentViewEvents: [
        {
          id: 'event-1',
          actorId: 'user-1',
          actorEmail: 'member@example.com',
          metadata: { source: 'native', authoritative: true },
          createdAt: new Date('2026-07-24T12:00:00Z'),
          actor: { firstName: 'Mary', lastName: 'Member', email: 'member@example.com' },
        },
      ],
      recentSessions: [
        {
          id: 'session-1',
          userId: null,
          visitorEmail: 'guest@example.com',
          visitorName: 'Guest User',
          totalTimeSpentSeconds: 30,
          lastActivityAt: new Date('2026-07-23T08:00:00Z'),
          user: null,
        },
      ],
    });

    expect(body.recentViewers).toHaveLength(2);
    // Sorted by lastActive desc: member (24th) before share-link (23rd).
    expect(body.recentViewers[0]).toEqual(
      expect.objectContaining({
        email: 'member@example.com',
        name: 'Mary Member',
        identityLabel: 'Account identity',
        accessType: 'member',
        provenance: 'native',
        auditStatus: 'authoritative',
      })
    );
    expect(body.recentViewers[1]).toEqual(
      expect.objectContaining({
        email: 'guest@example.com',
        name: 'Guest User',
        identityLabel: 'Asserted email',
        accessType: 'share-link',
        provenance: 'inferred',
        auditStatus: 'inferred',
      })
    );
  });

  it('excludes anonymous (no-email) access from the unique-viewer count but shows it in recent', async () => {
    const { body } = await getBody({
      memberGroups: [],
      linkGroups: [{ userId: null, visitorEmail: null }],
      recentSessions: [
        {
          id: 'session-anon',
          userId: null,
          visitorEmail: null,
          visitorName: null,
          totalTimeSpentSeconds: 5,
          lastActivityAt: new Date('2026-07-23T08:00:00Z'),
          user: null,
        },
      ],
    });
    expect(body.summary.uniqueViewers).toBe(0);
    expect(body.recentViewers).toHaveLength(1);
    expect(body.recentViewers[0].identityLabel).toBe('Anonymous viewer');
  });

  it('groups anonymous share-link sessions and prioritizes identified viewers in recent activity', async () => {
    const { body } = await getBody({
      recentSessions: [
        {
          id: 'session-anon-new',
          userId: null,
          visitorEmail: null,
          visitorName: null,
          totalTimeSpentSeconds: 15,
          lastActivityAt: new Date('2026-08-13T12:00:00Z'),
          user: null,
        },
        {
          id: 'session-anon-old',
          userId: null,
          visitorEmail: null,
          visitorName: null,
          totalTimeSpentSeconds: 10,
          lastActivityAt: new Date('2026-08-13T11:00:00Z'),
          user: null,
        },
        {
          id: 'session-identified',
          userId: null,
          visitorEmail: 'known@example.com',
          visitorName: 'Known Viewer',
          totalTimeSpentSeconds: 5,
          lastActivityAt: new Date('2026-08-13T10:00:00Z'),
          user: null,
        },
      ],
    });

    expect(body.recentViewers).toHaveLength(2);
    expect(body.recentViewers[0]).toEqual(
      expect.objectContaining({ email: 'known@example.com', name: 'Known Viewer' })
    );
    expect(body.recentViewers[1]).toEqual(
      expect.objectContaining({ email: null, identityLabel: 'Anonymous viewer' })
    );
  });

  it('keeps analytics admin-only', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'viewer-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as Awaited<ReturnType<typeof requireAuth>>);

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });
});
