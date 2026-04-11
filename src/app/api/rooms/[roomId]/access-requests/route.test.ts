/**
 * Access Requests API Tests
 *
 * Validates GET (list) for room access requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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
  room: { findFirst: vi.fn() },
  accessRequest: { findMany: vi.fn(), count: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET } from './route';

const mockRoom = { id: 'room-1', organizationId: 'org-1' };

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

describe('GET /api/rooms/:roomId/access-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
  });

  it('returns access requests list', async () => {
    const requests = [
      { id: 'ar-1', email: 'alice@example.com', status: 'PENDING', reviewedBy: null },
      {
        id: 'ar-2',
        email: 'bob@example.com',
        status: 'APPROVED',
        reviewedBy: { id: 'u-1', firstName: 'Admin', lastName: 'User', email: 'admin@example.com' },
      },
    ];
    mockTx.accessRequest.count.mockResolvedValue(2);
    mockTx.accessRequest.findMany.mockResolvedValue(requests);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/access-requests');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accessRequests).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('filters by status query param', async () => {
    mockTx.accessRequest.count.mockResolvedValue(1);
    mockTx.accessRequest.findMany.mockResolvedValue([
      { id: 'ar-1', email: 'alice@example.com', status: 'PENDING', reviewedBy: null },
    ]);

    const req = new NextRequest(
      'http://localhost:3000/api/rooms/room-1/access-requests?status=PENDING'
    );
    await GET(req, makeContext());

    const whereArg = mockTx.accessRequest.findMany.mock.calls[0]![0].where;
    expect(whereArg.status).toBe('PENDING');
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'VIEWER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/access-requests');
    const res = await GET(req, makeContext());

    expect(res.status).toBe(403);
  });
});
