/**
 * Admin Activity Log API Tests (F040)
 *
 * Tests for organization-wide activity log with filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// Mock auth middleware
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock database
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

interface MockEvent {
  id: string;
  eventType: string;
  actorType?: string;
  actor?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  actorEmail?: string | null;
  room?: { id: string; name: string } | null;
  description?: string | null;
  ipAddress?: string | null;
  createdAt: Date;
  documentId?: string | null;
  provenance?: string;
  auditStatus?: string;
  sourceMetadata?: { source: string; sourceId: string };
}

function makeActivityResult(events: MockEvent[], total: number) {
  return {
    records: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actorType: event.actorType ?? 'SYSTEM',
      actor: event.actor
        ? {
            id: event.actor.id,
            name: `${event.actor.firstName} ${event.actor.lastName}`.trim(),
            email: event.actor.email,
            identityLabel: 'Account identity',
          }
        : event.actorEmail
          ? { email: event.actorEmail, identityLabel: 'Asserted email' }
          : null,
      room: event.room,
      description: event.description,
      ipAddress: event.ipAddress,
      createdAt: event.createdAt,
      documentId: event.documentId ?? null,
      provenance: event.provenance ?? 'legacy',
      auditStatus: event.auditStatus ?? 'authoritative',
      sourceMetadata: event.sourceMetadata ?? { source: 'legacy_event', sourceId: event.id },
    })),
    total,
    folderByDocId: new Map(),
    auditCaptureMode: 'OFF',
    exportTruncated: false,
  };
}

describe('GET /api/organization/activity', () => {
  const mockAdminSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockAdminSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
    } as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(403);
  });

  it('returns paginated activity events', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_UPLOADED',
        actorType: 'ADMIN',
        description: 'Uploaded file.pdf',
        ipAddress: '192.168.1.1',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        actor: { id: 'user-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
        room: { id: 'room-1', name: 'Due Diligence' },
        actorEmail: null,
      },
    ];

    mockWithOrgContext.mockResolvedValue(makeActivityResult(mockEvents, 1));

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventType).toBe('DOCUMENT_UPLOADED');
    expect(body.events[0].actor.name).toBe('John Doe');
    expect(body.pagination.total).toBe(1);
  });

  it('supports pagination parameters', async () => {
    mockWithOrgContext.mockResolvedValue(makeActivityResult([], 150));

    const request = new NextRequest('http://localhost/api/organization/activity?page=3&limit=25');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pagination.page).toBe(3);
    expect(body.pagination.limit).toBe(25);
    expect(body.pagination.totalPages).toBe(6);
  });

  it('enforces max limit of 100', async () => {
    mockWithOrgContext.mockResolvedValue(makeActivityResult([], 500));

    const request = new NextRequest('http://localhost/api/organization/activity?limit=200');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pagination.limit).toBe(100);
  });

  it('merges unlinked viewer sessions as inferred rows without duplicating native access', async () => {
    const eventFindMany = vi.fn().mockResolvedValue([
      {
        id: 'event-1',
        eventType: 'LINK_ACCESSED',
        actorType: 'VIEWER',
        actor: null,
        actorEmail: 'native@example.com',
        room: { id: 'room-1', name: 'Investor Room' },
        description: 'Share link accessed',
        ipAddress: '198.51.100.23',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        documentId: null,
        metadata: { source: 'native', authoritative: false },
      },
    ]);
    const viewSessionFindMany = vi.fn().mockResolvedValue([
      {
        id: 'viewer-session-legacy',
        createdAt: new Date('2024-01-15T11:00:00Z'),
        visitorEmail: 'inferred@example.com',
        visitorName: 'External Viewer',
        ipAddress: '2001:db8:1234:5678::1',
        user: null,
        room: { id: 'room-1', name: 'Investor Room' },
      },
    ]);
    const documentFindMany = vi.fn().mockResolvedValue([]);

    mockWithOrgContext.mockImplementation(async (_organizationId, callback) =>
      callback({
        event: { findMany: eventFindMany, count: vi.fn().mockResolvedValue(1) },
        viewSession: {
          findMany: viewSessionFindMany,
          count: vi.fn().mockResolvedValue(1),
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({ auditCaptureMode: 'SHADOW' }),
        },
        room: { findMany: vi.fn().mockResolvedValue([]) },
        document: { findMany: documentFindMany },
      } as never)
    );

    const response = await GET(new NextRequest('http://localhost/api/organization/activity'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pagination.total).toBe(2);
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        id: 'inferred-view-session-viewer-session-legacy',
        provenance: 'inferred',
        auditStatus: 'inferred',
        ipAddress: '2001:db8:1234:…',
        sourceMetadata: { source: 'view_session', sourceId: 'viewer-session-legacy' },
      })
    );
    expect(body.events[0].actor.identityLabel).toBe('Asserted email');
    expect(body.events[1]).toEqual(
      expect.objectContaining({
        provenance: 'native',
        auditStatus: 'shadow',
        ipAddress: '198.51.100.xxx',
      })
    );
    expect(body.coverage.auditCaptureMode).toBe('SHADOW');
    expect(viewSessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          events: { none: { eventType: 'LINK_ACCESSED' } },
        }),
      })
    );
  });

  it('filters by userId', async () => {
    mockWithOrgContext.mockResolvedValue(makeActivityResult([], 0));

    const request = new NextRequest('http://localhost/api/organization/activity?userId=user-2');
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('filters by eventType', async () => {
    mockWithOrgContext.mockResolvedValue(makeActivityResult([], 0));

    const request = new NextRequest(
      'http://localhost/api/organization/activity?eventType=DOCUMENT_DOWNLOADED'
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('filters by roomId', async () => {
    mockWithOrgContext.mockResolvedValue(makeActivityResult([], 0));

    const request = new NextRequest('http://localhost/api/organization/activity?roomId=room-1');
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('filters by date range', async () => {
    mockWithOrgContext.mockResolvedValue(makeActivityResult([], 0));

    const request = new NextRequest(
      'http://localhost/api/organization/activity?from=2024-01-01&to=2024-01-31'
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('exports as CSV when export=csv', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_VIEWED',
        description: '@SUM(1+1)',
        ipAddress: '10.0.0.1',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        actor: { id: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
        room: { id: 'room-1', name: '-Financials' },
        actorEmail: null,
      },
    ];

    mockWithOrgContext.mockResolvedValue(makeActivityResult(mockEvents, 1));

    const request = new NextRequest('http://localhost/api/organization/activity?export=csv');
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');

    const csv = await response.text();
    expect(csv).toContain('"Timestamp","Event Type","Actor"');
    expect(csv).toContain('"IP Address (Redacted)"');
    expect(response.headers.get('X-Activity-Export-Truncated')).toBe('false');
    expect(csv).toContain('DOCUMENT_VIEWED');
    expect(csv).toContain('Jane Doe');
    expect(csv).toContain('"\'-Financials"');
    expect(csv).toContain('"\'@SUM(1+1)"');
  });

  it('handles events without actors', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'SYSTEM_BACKUP',
        description: 'Automatic backup',
        ipAddress: null,
        createdAt: new Date('2024-01-15T10:00:00Z'),
        actor: null,
        room: null,
        actorEmail: null,
      },
    ];

    mockWithOrgContext.mockResolvedValue(makeActivityResult(mockEvents, 1));

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events[0].actor).toBeNull();
    expect(body.events[0].room).toBeNull();
  });

  it('handles events with email-only actors', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        eventType: 'DOCUMENT_VIEWED',
        description: 'External viewer',
        ipAddress: '1.2.3.4',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        actor: null,
        room: { id: 'room-1', name: 'Public Room' },
        actorEmail: 'external@viewer.com',
      },
    ];

    mockWithOrgContext.mockResolvedValue(makeActivityResult(mockEvents, 1));

    const request = new NextRequest('http://localhost/api/organization/activity');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events[0].actor.email).toBe('external@viewer.com');
    expect(body.events[0].actor.identityLabel).toBe('Asserted email');
    expect(body.coverage.identityNotice).toContain('asserted, not verified');
  });
});
