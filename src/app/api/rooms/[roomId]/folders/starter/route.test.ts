import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  withOrgContext: vi.fn(),
  roomFindFirst: vi.fn(),
  folderFindMany: vi.fn(),
  folderCreateMany: vi.fn(),
  roomTemplateFindFirst: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock('@/lib/middleware', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));

import { POST } from './route';

const adminSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
};

function context() {
  return { params: Promise.resolve({ roomId: 'room-1' }) };
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/rooms/room-1/folders/starter', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/rooms/:roomId/folders/starter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(adminSession);
    mocks.roomFindFirst.mockResolvedValue({ id: 'room-1', name: 'Board Room', status: 'DRAFT' });
    mocks.folderFindMany.mockImplementation(
      ({ where, select }: { where: { path: { in: string[] } }; select: Record<string, boolean> }) =>
        Promise.resolve(
          select['id'] ? where.path.in.map((path) => ({ id: `id-${path}`, path })) : []
        )
    );
    mocks.withOrgContext.mockImplementation(
      async (_organizationId: string, callback: (tx: unknown) => unknown) =>
        callback({
          room: { findFirst: mocks.roomFindFirst },
          roomTemplate: { findFirst: mocks.roomTemplateFindFirst },
          folder: { findMany: mocks.folderFindMany, createMany: mocks.folderCreateMany },
          event: { create: mocks.eventCreate },
        })
    );
  });

  it('adds selected folders at the room root and writes an audit event', async () => {
    const response = await POST(
      request({
        templateId: 'board-portal',
        selectedFolderPaths: ['/board-meetings/agendas-minutes'],
      }),
      context()
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true, createdFolderCount: 2 });
    expect(mocks.folderCreateMany).toHaveBeenCalledTimes(2);
    expect(mocks.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'ROOM_UPDATED',
          metadata: { templateId: 'board-portal', starterFolderCount: 2 },
        }),
      })
    );
  });

  it('rejects the entire request when any selected path already exists', async () => {
    mocks.folderFindMany.mockResolvedValueOnce([{ path: '/board-meetings' }]);

    const response = await POST(
      request({ templateId: 'board-portal', selectedFolderPaths: ['/board-meetings'] }),
      context()
    );

    expect(response.status).toBe(409);
    expect(mocks.folderCreateMany).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it('keeps the endpoint admin-only even when called directly', async () => {
    mocks.requireAuth.mockResolvedValue({ ...adminSession, organization: { role: 'VIEWER' } });

    const response = await POST(
      request({ templateId: 'board-portal', selectedFolderPaths: ['/board-meetings'] }),
      context()
    );

    expect(response.status).toBe(403);
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
  });
});
