import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createContext: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'request-1',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
  requireAuthFromRequest: mocks.requireAuth,
}));

vi.mock('@/services', () => ({
  createServiceContext: mocks.createContext,
  roomService: { list: mocks.list },
}));

vi.mock('@/lib/db', () => ({ withOrgContext: vi.fn() }));

import { GET } from './route';

describe('GET /api/rooms authorization adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const session = { userId: 'viewer-1', organizationId: 'org-1' };
    const ctx = { session };
    mocks.requireAuth.mockResolvedValue(session);
    mocks.createContext.mockReturnValue(ctx);
    mocks.list.mockResolvedValue({
      items: [{ id: 'room-allowed', name: 'Allowed room' }],
      total: 1,
      offset: 0,
      limit: 100,
      hasMore: false,
    });
  });

  it('delegates listing to RoomService and returns its authorized page', async () => {
    const request = new NextRequest(
      'http://localhost/api/rooms?status=ACTIVE&search=allowed&limit=500&offset=-2'
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ userId: 'viewer-1' }) }),
      {
        status: 'ACTIVE',
        search: 'allowed',
        limit: 100,
        offset: 0,
      }
    );
    expect(body).toEqual({
      rooms: [{ id: 'room-allowed', name: 'Allowed room' }],
      pagination: { total: 1, offset: 0, limit: 100, hasMore: false },
    });
  });

  it('does not pass an unknown status to the service', async () => {
    await GET(new NextRequest('http://localhost/api/rooms?status=NOT_A_STATUS'));

    expect(mocks.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: undefined })
    );
  });
});
