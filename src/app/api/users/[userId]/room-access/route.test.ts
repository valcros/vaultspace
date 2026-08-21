import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, PATCH } from './route';

vi.mock('@/lib/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db', () => ({ withOrgContext: vi.fn() }));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

const adminSession = {
  userId: 'admin-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
  user: { email: 'admin@example.com' },
};
const context = { params: Promise.resolve({ userId: 'member-1' }) };

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 'membership-1',
    role: 'VIEWER',
    isActive: true,
    user: { id: 'member-1', email: 'viewer@example.com', isActive: true },
    ...overrides,
  };
}

describe('member room-access API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(adminSession as Awaited<ReturnType<typeof requireAuth>>);
  });

  it('denies a Viewer before querying room access', async () => {
    mockRequireAuth.mockResolvedValue({
      ...adminSession,
      organization: { role: 'VIEWER' },
    } as Awaited<ReturnType<typeof requireAuth>>);

    const response = await GET(
      new NextRequest('http://localhost/api/users/member-1/room-access'),
      context
    );

    expect(response.status).toBe(403);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('returns direct active room grants without treating expired grants as access', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(member()) },
        room: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'room-1', name: 'Current Round', description: null },
            { id: 'room-2', name: 'Second Round', description: 'Follow-on material' },
          ]),
        },
        permission: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'permission-current',
              roomId: 'room-1',
              resourceType: 'ROOM',
              permissionLevel: 'VIEW',
              expiresAt: null,
            },
            {
              id: 'permission-expired',
              roomId: 'room-2',
              resourceType: 'ROOM',
              permissionLevel: 'VIEW',
              expiresAt: new Date('2020-01-01'),
            },
          ]),
        },
        roleAssignment: { findMany: vi.fn().mockResolvedValue([]) },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
      };
      return callback(tx as never);
    });

    const response = await GET(
      new NextRequest('http://localhost/api/users/member-1/room-access'),
      context
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      editable: true,
      rooms: [
        { id: 'room-1', hasDirectAccess: true },
        { id: 'room-2', hasDirectAccess: false },
      ],
    });
  });

  it('reports a current direct document grant as scoped access without checking the room grant box', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(member()) },
        room: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'room-1', name: 'Current Round', description: null }]),
        },
        permission: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              {
                id: 'document-only',
                roomId: null,
                resourceType: 'DOCUMENT',
                permissionLevel: 'DOWNLOAD',
                expiresAt: null,
                folder: null,
                document: { roomId: 'room-1' },
              },
            ]),
        },
        roleAssignment: { findMany: vi.fn().mockResolvedValue([]) },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
      };
      return callback(tx as never);
    });

    const response = await GET(
      new NextRequest('http://localhost/api/users/member-1/room-access'),
      context
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rooms: [
        {
          id: 'room-1',
          hasDirectAccess: false,
          directScopedGrantCount: 1,
          effectiveAccess: 'SCOPED',
        },
      ],
    });
  });

  it('reports current group-scoped access without treating it as editable room access', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(member()) },
        room: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'room-1', name: 'Current Round', description: null }]),
        },
        permission: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              {
                id: 'group-document-only',
                roomId: null,
                resourceType: 'DOCUMENT',
                permissionLevel: 'VIEW',
                expiresAt: null,
                folder: null,
                document: { roomId: 'room-1' },
              },
            ]),
        },
        roleAssignment: { findMany: vi.fn().mockResolvedValue([]) },
        groupMembership: { findMany: vi.fn().mockResolvedValue([{ groupId: 'group-1' }]) },
      };
      return callback(tx as never);
    });

    const response = await GET(
      new NextRequest('http://localhost/api/users/member-1/room-access'),
      context
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rooms: [
        {
          id: 'room-1',
          hasDirectAccess: false,
          directScopedGrantCount: 0,
          indirectScopedGrantCount: 1,
          indirectScopedSources: ['GROUP'],
          effectiveAccess: 'SCOPED',
        },
      ],
    });
  });

  it('does not report expired group-scoped grants as access', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(member()) },
        room: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'room-1', name: 'Current Round', description: null }]),
        },
        permission: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              {
                id: 'expired-group-folder',
                roomId: null,
                resourceType: 'FOLDER',
                permissionLevel: 'VIEW',
                expiresAt: new Date('2020-01-01'),
                folder: { roomId: 'room-1' },
                document: null,
              },
            ]),
        },
        roleAssignment: { findMany: vi.fn().mockResolvedValue([]) },
        groupMembership: { findMany: vi.fn().mockResolvedValue([{ groupId: 'group-1' }]) },
      };
      return callback(tx as never);
    });

    const response = await GET(
      new NextRequest('http://localhost/api/users/member-1/room-access'),
      context
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rooms: [{ id: 'room-1', indirectScopedGrantCount: 0, effectiveAccess: 'NONE' }],
    });
  });

  it('does not permit an archived member to receive room access', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(1),
        userOrganization: { findFirst: vi.fn().mockResolvedValue(member({ isActive: false })) },
      };
      return callback(tx as never);
    });

    const response = await PATCH(
      new NextRequest('http://localhost/api/users/member-1/room-access', {
        method: 'PATCH',
        body: JSON.stringify({ roomIds: ['room-1'] }),
      }),
      context
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/archived/i);
  });

  it('rejects a room identifier from another organization', async () => {
    const roomFindMany = vi.fn().mockResolvedValue([{ id: 'room-1', name: 'Current Round' }]);
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(1),
        userOrganization: { findFirst: vi.fn().mockResolvedValue(member()) },
        room: { findMany: roomFindMany },
      };
      return callback(tx as never);
    });

    const response = await PATCH(
      new NextRequest('http://localhost/api/users/member-1/room-access', {
        method: 'PATCH',
        body: JSON.stringify({ roomIds: ['room-in-another-org'] }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/belong to this organization/i);
    expect(roomFindMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      select: { id: true, name: true, status: true },
    });
  });

  it('atomically grants selected rooms and revokes direct room descendants removed from scope', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const eventCreate = vi.fn().mockResolvedValue({});
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(1),
        userOrganization: { findFirst: vi.fn().mockResolvedValue(member()) },
        room: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'room-1', name: 'Current Round', status: 'ACTIVE' },
            { id: 'room-2', name: 'Second Round', status: 'ACTIVE' },
          ]),
        },
        permission: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([
              {
                id: 'old-room',
                roomId: 'room-1',
                resourceType: 'ROOM',
                permissionLevel: 'VIEW',
                expiresAt: null,
              },
            ])
            .mockResolvedValueOnce([
              {
                id: 'old-document',
                roomId: 'room-1',
                resourceType: 'DOCUMENT',
                permissionLevel: 'DOWNLOAD',
                expiresAt: null,
              },
            ]),
          updateMany,
          createMany,
        },
        folder: { findMany: vi.fn().mockResolvedValue([]) },
        document: { findMany: vi.fn().mockResolvedValue([]) },
        event: { create: eventCreate },
      };
      return callback(tx as never);
    });

    const response = await PATCH(
      new NextRequest('http://localhost/api/users/member-1/room-access', {
        method: 'PATCH',
        body: JSON.stringify({ roomIds: ['room-2'] }),
      }),
      context
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      grantedRoomIds: ['room-2'],
      revokedPermissionCount: 2,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-room', 'old-document'] } },
      data: { isActive: false },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          organizationId: 'org-1',
          roomId: 'room-2',
          userId: 'member-1',
          resourceType: 'ROOM',
          granteeType: 'USER',
          permissionLevel: 'VIEW',
        }),
      ],
    });
    expect(eventCreate).toHaveBeenCalledTimes(3);
  });
});
