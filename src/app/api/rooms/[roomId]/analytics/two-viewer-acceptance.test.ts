/**
 * User-facing acceptance test for the Analytics Correctness Fix.
 *
 * Scenario: ONE authenticated member and ONE share-link viewer both access a
 * room (with audit capture ON / SHADOW). Acceptance condition: both appear
 * accurately in Room Analytics AND Organization Activity, with correct
 * distinct-viewer counts, document activity, provenance, and timeline entries.
 *
 * Attribute-to-surface mapping (per the surfaces' contracts):
 *  - distinct-viewer count + recent viewers + document activity + operational-vs-
 *    captured reconciliation  -> Room Analytics (owns the distinct count).
 *  - both viewers as timeline entries with correct provenance -> Organization
 *    Activity (an event stream; has no distinct-viewer count of its own).
 *
 * The fixtures inject rows directly and set capture ON, so this is independent
 * of any production capture-mode / traffic posture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db', () => ({ withOrgContext: vi.fn() }));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { GET as getRoomAnalytics } from './route';
import { GET as getOrgActivity } from '@/app/api/organization/activity/route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

// Shared two-viewer fixture.
const MEMBER = {
  id: 'member-1',
  email: 'mary@brightside.test',
  firstName: 'Mary',
  lastName: 'Member',
  viewedAt: new Date('2026-08-04T10:00:00Z'),
};
const GUEST = {
  email: 'guest@partner.test',
  name: 'Guest Partner',
  sessionId: 'sess-1',
  accessedAt: new Date('2026-08-04T09:00:00Z'),
};
const ROOM = { id: 'room-1', name: 'Series A Room' };
const DOC = { id: 'doc-1', name: 'Deck.pdf' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    userId: 'admin-1',
    sessionId: 'admin-session',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
    user: { email: 'admin@brightside.test' },
  } as Awaited<ReturnType<typeof requireAuth>>);
});

describe('Analytics correctness acceptance: one member + one share-link viewer', () => {
  it('Room Analytics: distinct-viewer count = 2, both viewers with correct provenance + document activity', async () => {
    mockWithOrgContext.mockImplementation(async (_org, cb) =>
      cb({
        room: { findFirst: vi.fn().mockResolvedValue({ id: ROOM.id }) },
        document: {
          count: vi.fn().mockResolvedValue(1),
          aggregate: vi.fn().mockResolvedValue({ _sum: { viewCount: 12, downloadCount: 1 } }),
          findMany: vi.fn().mockResolvedValue([
            {
              id: DOC.id,
              name: DOC.name,
              viewCount: 12,
              downloadCount: 1,
              lastViewedAt: MEMBER.viewedAt,
              createdAt: new Date('2026-08-01T00:00:00Z'),
            },
          ]),
        },
        event: {
          count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
          // Distinct member/asserted-email identities from DOCUMENT_VIEWED events.
          groupBy: vi.fn().mockResolvedValue([{ actorId: MEMBER.id, actorEmail: MEMBER.email }]),
          findMany: vi
            .fn()
            // recent view events (member view)
            .mockResolvedValueOnce([
              {
                id: 'ev-member',
                actorId: MEMBER.id,
                actorEmail: MEMBER.email,
                metadata: { source: 'native', authoritative: false },
                createdAt: MEMBER.viewedAt,
                actor: {
                  firstName: MEMBER.firstName,
                  lastName: MEMBER.lastName,
                  email: MEMBER.email,
                },
              },
            ])
            // recent events feed
            .mockResolvedValueOnce([
              {
                id: 'ev-member',
                eventType: 'DOCUMENT_VIEWED',
                description: 'Viewed a document',
                actorEmail: MEMBER.email,
                actor: {
                  firstName: MEMBER.firstName,
                  lastName: MEMBER.lastName,
                  email: MEMBER.email,
                },
                metadata: { source: 'native', authoritative: false },
                createdAt: MEMBER.viewedAt,
              },
            ]),
        },
        viewSession: {
          groupBy: vi.fn().mockResolvedValue([{ userId: null, visitorEmail: GUEST.email }]),
          findMany: vi.fn().mockResolvedValue([
            {
              id: GUEST.sessionId,
              userId: null,
              visitorEmail: GUEST.email,
              visitorName: GUEST.name,
              totalTimeSpentSeconds: 45,
              lastActivityAt: GUEST.accessedAt,
              user: null,
            },
          ]),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([{ id: MEMBER.id, email: MEMBER.email }]),
        },
        organization: { findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'SHADOW' }) },
        $queryRaw: vi
          .fn()
          .mockResolvedValue([{ day: new Date('2026-08-04T00:00:00Z'), views: BigInt(2) }]),
      } as never)
    );

    const response = await getRoomAnalytics(
      new NextRequest('http://localhost/api/rooms/room-1/analytics'),
      { params: Promise.resolve({ roomId: ROOM.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    // Distinct-viewer count owns here: member + share-link viewer = 2.
    expect(body.summary.uniqueViewers).toBe(2);
    // Document activity present.
    expect(body.summary.totalDocuments).toBe(1);
    expect(body.topDocuments[0]).toEqual(
      expect.objectContaining({ name: DOC.name, viewCount: 12 })
    );

    // Both viewers present with correct provenance / access type.
    const byEmail = Object.fromEntries(
      body.recentViewers.map((v: { email: string }) => [v.email, v])
    );
    expect(byEmail[MEMBER.email]).toEqual(
      expect.objectContaining({
        name: 'Mary Member',
        identityLabel: 'Account identity',
        accessType: 'member',
        provenance: 'native',
        auditStatus: 'shadow',
      })
    );
    expect(byEmail[GUEST.email]).toEqual(
      expect.objectContaining({
        identityLabel: 'Asserted email',
        accessType: 'share-link',
        provenance: 'inferred',
        auditStatus: 'inferred',
      })
    );

    // Operational preview counts remain a SEPARATE, reconciled metric.
    expect(body.auditReconciliation).toEqual(
      expect.objectContaining({
        operationalViewCount: 12,
        capturedViewEvents: 2,
        distinctViewers: 2,
        viewDelta: 10,
      })
    );
  });

  it('Organization Activity: both viewers appear as timeline entries with correct provenance', async () => {
    mockWithOrgContext.mockImplementation(async (_org, cb) =>
      cb({
        room: { findMany: vi.fn().mockResolvedValue([]) },
        document: {
          findMany: vi.fn().mockResolvedValue([{ id: DOC.id, folder: null }]),
        },
        event: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'ev-member',
              eventType: 'DOCUMENT_VIEWED',
              actorType: 'VIEWER',
              actor: {
                id: MEMBER.id,
                firstName: MEMBER.firstName,
                lastName: MEMBER.lastName,
                email: MEMBER.email,
              },
              actorEmail: MEMBER.email,
              room: { id: ROOM.id, name: ROOM.name },
              description: 'Viewed a document',
              ipAddress: null,
              metadata: { source: 'native', authoritative: false },
              createdAt: MEMBER.viewedAt,
              documentId: DOC.id,
            },
          ]),
          count: vi.fn().mockResolvedValue(1),
        },
        viewSession: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: GUEST.sessionId,
              createdAt: GUEST.accessedAt,
              visitorEmail: GUEST.email,
              visitorName: GUEST.name,
              ipAddress: null,
              user: null,
              room: { id: ROOM.id, name: ROOM.name },
            },
          ]),
          count: vi.fn().mockResolvedValue(1),
        },
        organization: { findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'SHADOW' }) },
      } as never)
    );

    const response = await getOrgActivity(
      new NextRequest('http://localhost/api/organization/activity')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const byEmail = Object.fromEntries(
      body.events
        .filter((e: { actor: { email?: string } | null }) => e.actor?.email)
        .map((e: { actor: { email: string } }) => [e.actor.email, e])
    );

    // Member: native DOCUMENT_VIEWED timeline entry.
    expect(byEmail[MEMBER.email]).toEqual(
      expect.objectContaining({
        eventType: 'DOCUMENT_VIEWED',
        provenance: 'native',
        auditStatus: 'shadow',
      })
    );
    // Share-link viewer: inferred session timeline entry.
    expect(byEmail[GUEST.email]).toEqual(
      expect.objectContaining({
        eventType: 'LINK_ACCESSED',
        provenance: 'inferred',
        auditStatus: 'inferred',
      })
    );
    expect(byEmail[GUEST.email].id).toContain('inferred-view-session-');
    expect(body.pagination.total).toBe(2);
  });
});
