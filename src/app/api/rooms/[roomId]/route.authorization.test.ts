import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getRequestContext: vi.fn(),
  createServiceContext: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({
  requireAuth: mocks.requireAuth,
  getRequestContext: mocks.getRequestContext,
}));

vi.mock('@/services', () => ({
  createServiceContext: mocks.createServiceContext,
  roomService: { getById: mocks.getById, update: mocks.update },
}));

import { GET, PATCH } from './route';

const session = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'VIEWER' },
};

function request(): NextRequest {
  return new NextRequest('https://vaultspace.org/api/rooms/room-1');
}

describe('GET /api/rooms/[roomId] authorization adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.getRequestContext.mockReturnValue({
      requestId: 'request-1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    mocks.createServiceContext.mockReturnValue({ session, requestId: 'request-1' });
  });

  it('delegates room access to RoomService.getById', async () => {
    const room = { id: 'room-1', name: 'Authorized room' };
    mocks.getById.mockResolvedValue(room);

    const response = await GET(request(), { params: Promise.resolve({ roomId: 'room-1' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ room });
    expect(mocks.getById).toHaveBeenCalledWith({ session, requestId: 'request-1' }, 'room-1');
  });

  it('returns 404 when the service hides an unauthorized room', async () => {
    mocks.getById.mockResolvedValue(null);

    const response = await GET(request(), { params: Promise.resolve({ roomId: 'room-1' }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Room not found' });
  });
});

describe('PATCH /api/rooms/[roomId] lifecycle adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      ...session,
      organization: { role: 'ADMIN' },
    });
    mocks.getRequestContext.mockReturnValue({
      requestId: 'request-1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    mocks.createServiceContext.mockReturnValue({ session, requestId: 'request-1' });
  });

  it('delegates settings and a status transition together to RoomService', async () => {
    const active = { id: 'room-1', organizationId: 'org-1', status: 'ACTIVE' };
    mocks.update.mockResolvedValue(active);

    const response = await PATCH(
      new NextRequest('https://vaultspace.org/api/rooms/room-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ACTIVE', allowDownloads: false }),
      }),
      { params: Promise.resolve({ roomId: 'room-1' }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ room: active });
    expect(mocks.update).toHaveBeenCalledWith({ session, requestId: 'request-1' }, 'room-1', {
      status: 'ACTIVE',
      allowDownloads: false,
    });
  });

  it('rejects invalid request fields before invoking the lifecycle service', async () => {
    const response = await PATCH(
      new NextRequest('https://vaultspace.org/api/rooms/room-1', {
        method: 'PATCH',
        body: JSON.stringify({ allowDownloads: 'false' }),
      }),
      { params: Promise.resolve({ roomId: 'room-1' }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
