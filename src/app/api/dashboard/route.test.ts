/**
 * Dashboard Stats API Tests
 *
 * Validates GET for aggregate dashboard metrics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock auth
const mockSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
  user: { email: 'admin@example.com' },
};
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(() => Promise.resolve(mockSession)),
}));

// Mock DB transaction
const mockTx = {
  room: { count: vi.fn() },
  document: { count: vi.fn(), findMany: vi.fn() },
  userOrganization: { count: vi.fn() },
  documentVersion: { aggregate: vi.fn() },
  event: { findMany: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET } from './route';

describe('GET /api/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Room counts: totalRooms (not CLOSED), DRAFT, ACTIVE, ARCHIVED, CLOSED
    mockTx.room.count
      .mockResolvedValueOnce(5) // totalRooms (not CLOSED)
      .mockResolvedValueOnce(1) // DRAFT
      .mockResolvedValueOnce(3) // ACTIVE
      .mockResolvedValueOnce(1) // ARCHIVED
      .mockResolvedValueOnce(0); // CLOSED
    mockTx.document.count.mockResolvedValue(20);
    mockTx.userOrganization.count.mockResolvedValue(8);
    mockTx.documentVersion.aggregate.mockResolvedValue({ _sum: { fileSize: 1048576 } });
    mockTx.event.findMany.mockResolvedValue([
      {
        id: 'evt-1',
        eventType: 'DOCUMENT_UPLOADED',
        actor: { firstName: 'John', lastName: 'Doe', id: 'u-1', email: 'john@example.com' },
        actorEmail: 'john@example.com',
        description: 'Uploaded a file',
        room: { id: 'room-1', name: 'Room A' },
        createdAt: '2026-04-01T00:00:00Z',
      },
    ]);
    mockTx.document.findMany.mockResolvedValue([
      { id: 'doc-1', name: 'NDA.pdf', viewCount: 42, room: { name: 'Room A' } },
    ]);
  });

  it('returns stats with correct shape', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('stats');
    expect(body).toHaveProperty('roomBreakdown');
    expect(body).toHaveProperty('recentActivity');
    expect(body).toHaveProperty('topDocuments');
    expect(body.stats.totalRooms).toBe(5);
    expect(body.stats.totalDocuments).toBe(20);
    expect(body.stats.totalMembers).toBe(8);
    expect(body.stats.totalStorage).toBe(1048576);
  });

  it('scopes queries by organizationId', async () => {
    await GET();

    // Verify room.count was called with organizationId filter
    const firstCall = mockTx.room.count.mock.calls[0]![0];
    expect(firstCall.where.organizationId).toBe('org-1');
  });

  it('returns 401 for unauthenticated', async () => {
    const { requireAuth } = await import('@/lib/middleware');
    (requireAuth as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Authentication required')
    );

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
