import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionEngine } from './PermissionEngine';

vi.mock('../db', () => ({
  db: {
    userOrganization: { findUnique: vi.fn() },
    roleAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
    groupMembership: { findMany: vi.fn() },
    folder: { findFirst: vi.fn() },
    permission: { findMany: vi.fn() },
    link: { findUnique: vi.fn() },
  },
}));

import { db } from '../db';

type MockFunction = ReturnType<typeof vi.fn>;
const mockedDb = db as unknown as {
  userOrganization: { findUnique: MockFunction };
  roleAssignment: { findFirst: MockFunction; findMany: MockFunction };
  groupMembership: { findMany: MockFunction };
  folder: { findFirst: MockFunction };
  permission: { findMany: MockFunction };
  link: { findUnique: MockFunction };
};

function membership(role: 'ADMIN' | 'VIEWER' = 'VIEWER', isActive = true) {
  return { role, isActive } as never;
}

function permission(
  permissionLevel: 'NONE' | 'VIEW' | 'DOWNLOAD' | 'ADMIN',
  resourceType: 'ROOM' | 'FOLDER' | 'DOCUMENT',
  id: string
) {
  return {
    permissionLevel,
    resourceType,
    roomId: resourceType === 'ROOM' ? id : null,
    folderId: resourceType === 'FOLDER' ? id : null,
    documentId: resourceType === 'DOCUMENT' ? id : null,
  };
}

describe('PermissionEngine Option A authorization', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PermissionEngine();
    mockedDb.userOrganization.findUnique.mockResolvedValue(membership());
    mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
    mockedDb.roleAssignment.findMany.mockResolvedValue([]);
    mockedDb.groupMembership.findMany.mockResolvedValue([]);
    mockedDb.folder.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, parentId: null })
    );
    mockedDb.permission.findMany.mockResolvedValue([]);
    mockedDb.link.findUnique.mockResolvedValue(null);
  });

  it('does not trust caller-supplied role or group IDs', async () => {
    const result = await engine.evaluate(
      { userId: 'viewer-1', role: 'ADMIN', groupIds: ['untrusted-group'] },
      'view',
      { type: 'ROOM', organizationId: 'org-1', roomId: 'room-1' }
    );

    expect(result.allowed).toBe(false);
    expect(mockedDb.groupMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'viewer-1' }),
      })
    );
    expect(mockedDb.permission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [{ granteeType: 'USER', userId: 'viewer-1' }],
            },
          ]),
        }),
      })
    );
  });

  it('loads active group membership from the database', async () => {
    mockedDb.groupMembership.findMany.mockResolvedValue([{ groupId: 'group-1' }]);
    mockedDb.permission.findMany.mockResolvedValue([permission('VIEW', 'ROOM', 'room-1')]);

    const result = await engine.evaluate({ userId: 'viewer-1' }, 'view', {
      type: 'ROOM',
      organizationId: 'org-1',
      roomId: 'room-1',
    });

    expect(result.allowed).toBe(true);
    expect(mockedDb.permission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([{ granteeType: 'GROUP', groupId: { in: ['group-1'] } }]),
            },
          ]),
        }),
      })
    );
  });

  it('makes an explicit NONE decision beat all non-admin allows', async () => {
    mockedDb.permission.findMany.mockResolvedValue([
      permission('DOWNLOAD', 'DOCUMENT', 'doc-1'),
      permission('VIEW', 'ROOM', 'room-1'),
      permission('NONE', 'FOLDER', 'folder-1'),
    ]);

    const result = await engine.evaluate({ userId: 'viewer-1' }, 'view', {
      type: 'DOCUMENT',
      organizationId: 'org-1',
      roomId: 'room-1',
      folderId: 'folder-1',
      documentId: 'doc-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        allowed: false,
        level: 'NONE',
        reason: 'Explicit deny on folder',
        inheritedFrom: { type: 'FOLDER', id: 'folder-1' },
      })
    );
  });

  it('loads inheritable ancestor-folder decisions for nested resources', async () => {
    mockedDb.folder.findFirst.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === 'folder-child') {
        return Promise.resolve({ id: 'folder-child', parentId: 'folder-parent' });
      }
      return Promise.resolve({ id: 'folder-parent', parentId: null });
    });
    mockedDb.permission.findMany.mockResolvedValue([
      permission('VIEW', 'ROOM', 'room-1'),
      permission('NONE', 'FOLDER', 'folder-parent'),
    ]);

    const result = await engine.evaluate({ userId: 'viewer-1' }, 'view', {
      type: 'DOCUMENT',
      organizationId: 'org-1',
      roomId: 'room-1',
      folderId: 'folder-child',
      documentId: 'doc-1',
    });

    expect(result.allowed).toBe(false);
    expect(mockedDb.permission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([
                {
                  resourceType: 'FOLDER',
                  folderId: { in: ['folder-child', 'folder-parent'] },
                  inheritFromParent: true,
                },
              ]),
            },
          ]),
        }),
      })
    );
  });

  it('keeps persisted room ADMIN authority above non-admin ACL denies', async () => {
    mockedDb.roleAssignment.findFirst.mockResolvedValue({ role: 'ADMIN' } as never);
    mockedDb.permission.findMany.mockResolvedValue([permission('NONE', 'ROOM', 'room-1')]);

    const result = await engine.evaluate({ userId: 'room-admin' }, 'admin', {
      type: 'ROOM',
      organizationId: 'org-1',
      roomId: 'room-1',
    });

    expect(result).toEqual({ allowed: true, level: 'ADMIN', reason: 'Room admin' });
    expect(mockedDb.permission.findMany).not.toHaveBeenCalled();
  });

  it('denies immediately when organization membership is inactive', async () => {
    mockedDb.userOrganization.findUnique.mockResolvedValue(membership('VIEWER', false));

    const result = await engine.evaluate({ userId: 'viewer-1' }, 'view', {
      type: 'ROOM',
      organizationId: 'org-1',
      roomId: 'room-1',
    });

    expect(result.reason).toBe('No active organization membership');
    expect(mockedDb.permission.findMany).not.toHaveBeenCalled();
  });

  it('returns only authorized room IDs and excludes leaf-only grants', async () => {
    mockedDb.roleAssignment.findMany.mockResolvedValue([{ roomId: 'room-admin' }]);
    mockedDb.permission.findMany.mockResolvedValue([
      permission('VIEW', 'ROOM', 'room-view'),
      permission('VIEW', 'ROOM', 'room-denied'),
      permission('NONE', 'ROOM', 'room-denied'),
      {
        ...permission('VIEW', 'DOCUMENT', 'doc-1'),
        roomId: 'room-leaf-only',
      },
      permission('NONE', 'ROOM', 'room-admin'),
    ]);

    const result = await engine.getViewableRoomIds({ userId: 'viewer-1' }, 'org-1');

    expect(result).toEqual(new Set(['room-admin', 'room-view']));
  });

  it('returns unrestricted organization scope only for persisted org ADMIN', async () => {
    mockedDb.userOrganization.findUnique.mockResolvedValue(membership('ADMIN'));

    await expect(
      engine.getViewableRoomIds({ userId: 'admin-1', role: 'VIEWER' }, 'org-1')
    ).resolves.toBeNull();
  });

  it('uses the same decision for evaluate and explainPermission', async () => {
    mockedDb.permission.findMany.mockResolvedValue([permission('VIEW', 'ROOM', 'room-1')]);
    const resource = { type: 'ROOM' as const, organizationId: 'org-1', roomId: 'room-1' };

    const decision = await engine.evaluate({ userId: 'viewer-1' }, 'download', resource);
    const explanation = await engine.explainPermission(
      { userId: 'viewer-1' },
      'download',
      resource
    );

    expect(explanation.allowed).toBe(decision.allowed);
    expect(explanation.reasoning).toEqual([decision.reason]);
    expect(explanation.summary).toContain(decision.reason);
  });
});
