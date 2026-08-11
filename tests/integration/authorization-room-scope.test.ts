import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { withOrgContext } from '@/lib/db';
import { getDashboardData } from '@/lib/dashboard-data';
import { getPermissionEngine } from '@/lib/permissions';
import { RoomService } from '@/services/RoomService';
import type { ServiceContext } from '@/services/types';

import { prisma } from '../../vitest.integration.setup';

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

async function seedFixture() {
  const suffix = randomUUID();
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({
      data: { name: 'Synthetic Organization A', slug: `synthetic-a-${suffix}` },
    }),
    prisma.organization.create({
      data: { name: 'Synthetic Organization B', slug: `synthetic-b-${suffix}` },
    }),
  ]);
  const [viewerA, secondViewerA, viewerB] = await Promise.all([
    prisma.user.create({
      data: {
        email: `viewer-a-${suffix}@example.test`,
        passwordHash: 'synthetic-not-a-login-secret',
        firstName: 'Viewer',
        lastName: 'A',
      },
    }),
    prisma.user.create({
      data: {
        email: `viewer-a2-${suffix}@example.test`,
        passwordHash: 'synthetic-not-a-login-secret',
        firstName: 'Second',
        lastName: 'Viewer A',
      },
    }),
    prisma.user.create({
      data: {
        email: `viewer-b-${suffix}@example.test`,
        passwordHash: 'synthetic-not-a-login-secret',
        firstName: 'Viewer',
        lastName: 'B',
      },
    }),
  ]);
  await prisma.userOrganization.createMany({
    data: [
      { organizationId: orgA.id, userId: viewerA.id, role: 'VIEWER' },
      { organizationId: orgA.id, userId: secondViewerA.id, role: 'VIEWER' },
      { organizationId: orgB.id, userId: viewerB.id, role: 'VIEWER' },
    ],
  });
  const [roomA1, roomA2, roomA3, roomB1] = await Promise.all([
    prisma.room.create({
      data: {
        organizationId: orgA.id,
        name: 'Synthetic Room A1',
        slug: `room-a1-${suffix}`,
        status: 'ACTIVE',
      },
    }),
    prisma.room.create({
      data: {
        organizationId: orgA.id,
        name: 'Synthetic Room A2',
        slug: `room-a2-${suffix}`,
        status: 'ACTIVE',
      },
    }),
    prisma.room.create({
      data: {
        organizationId: orgA.id,
        name: 'Synthetic Room A3',
        slug: `room-a3-${suffix}`,
        status: 'ACTIVE',
      },
    }),
    prisma.room.create({
      data: {
        organizationId: orgB.id,
        name: 'Synthetic Room B1',
        slug: `room-b1-${suffix}`,
        status: 'ACTIVE',
      },
    }),
  ]);
  const folderA3 = await prisma.folder.create({
    data: {
      organizationId: orgA.id,
      roomId: roomA3.id,
      name: 'Synthetic Folder',
      path: '/synthetic-folder',
    },
  });
  const nestedFolderA3 = await prisma.folder.create({
    data: {
      organizationId: orgA.id,
      roomId: roomA3.id,
      parentId: folderA3.id,
      name: 'Synthetic Nested Folder',
      path: '/synthetic-folder/nested',
    },
  });
  const [documentA3, secondDocumentA3, nestedDocumentA3] = await Promise.all([
    prisma.document.create({
      data: {
        organizationId: orgA.id,
        roomId: roomA3.id,
        folderId: folderA3.id,
        name: 'Synthetic Document',
        mimeType: 'application/pdf',
        fileSize: 1,
        originalFileName: 'synthetic.pdf',
      },
    }),
    prisma.document.create({
      data: {
        organizationId: orgA.id,
        roomId: roomA3.id,
        folderId: folderA3.id,
        name: 'Second Synthetic Document',
        mimeType: 'application/pdf',
        fileSize: 1,
        originalFileName: 'synthetic-second.pdf',
      },
    }),
    prisma.document.create({
      data: {
        organizationId: orgA.id,
        roomId: roomA3.id,
        folderId: nestedFolderA3.id,
        name: 'Synthetic Nested Document',
        mimeType: 'application/pdf',
        fileSize: 1,
        originalFileName: 'synthetic-nested.pdf',
      },
    }),
  ]);

  return {
    orgA,
    orgB,
    viewerA,
    secondViewerA,
    viewerB,
    roomA1,
    roomA2,
    roomA3,
    roomB1,
    folderA3,
    nestedFolderA3,
    documentA3,
    secondDocumentA3,
    nestedDocumentA3,
  };
}

function roomResource(fixture: Fixture, roomId: string) {
  return { type: 'ROOM' as const, organizationId: fixture.orgA.id, roomId };
}

function serviceContext(fixture: Fixture, userId = fixture.viewerA.id): ServiceContext {
  return {
    session: {
      sessionId: `synthetic-session-${userId}`,
      userId,
      organizationId: fixture.orgA.id,
      user: {
        id: userId,
        email: 'synthetic-viewer@example.test',
        firstName: 'Synthetic',
        lastName: 'Viewer',
        isActive: true,
      },
      organization: {
        id: fixture.orgA.id,
        name: fixture.orgA.name,
        slug: fixture.orgA.slug,
        role: 'VIEWER',
        canManageUsers: false,
        canManageRooms: false,
      },
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
    requestId: 'synthetic-authorization-test',
  } as ServiceContext;
}

async function canViewRoom(fixture: Fixture, userId: string, roomId: string): Promise<boolean> {
  return withOrgContext(fixture.orgA.id, (tx) =>
    getPermissionEngine().can({ userId }, 'view', roomResource(fixture, roomId), tx)
  );
}

async function listedRoomIds(fixture: Fixture, userId = fixture.viewerA.id): Promise<string[]> {
  const result = await new RoomService().list(serviceContext(fixture, userId));
  return result.items.map(({ id }) => id).sort();
}

describe('W1-1 room-scoped authorization with the runtime database role', () => {
  it('does not treat active organization membership as room VIEW', async () => {
    const fixture = await seedFixture();

    await expect(canViewRoom(fixture, fixture.viewerA.id, fixture.roomA1.id)).resolves.toBe(false);
    await expect(canViewRoom(fixture, fixture.secondViewerA.id, fixture.roomA1.id)).resolves.toBe(
      false
    );
    await expect(listedRoomIds(fixture)).resolves.toEqual([]);
    const dashboard = await getDashboardData({
      organizationId: fixture.orgA.id,
      userId: fixture.viewerA.id,
    });
    expect(dashboard.myRooms).toEqual([]);
  });

  it('lists a direct room grant and removes access immediately after revocation', async () => {
    const fixture = await seedFixture();
    const grant = await prisma.permission.create({
      data: {
        organizationId: fixture.orgA.id,
        resourceType: 'ROOM',
        roomId: fixture.roomA1.id,
        granteeType: 'USER',
        userId: fixture.viewerA.id,
        permissionLevel: 'VIEW',
      },
    });

    await expect(canViewRoom(fixture, fixture.viewerA.id, fixture.roomA1.id)).resolves.toBe(true);
    await expect(listedRoomIds(fixture)).resolves.toEqual([fixture.roomA1.id]);
    const dashboard = await getDashboardData({
      organizationId: fixture.orgA.id,
      userId: fixture.viewerA.id,
    });
    expect(dashboard.myRooms?.map(({ id }) => id)).toEqual([fixture.roomA1.id]);
    await expect(canViewRoom(fixture, fixture.secondViewerA.id, fixture.roomA1.id)).resolves.toBe(
      false
    );

    await prisma.permission.update({ where: { id: grant.id }, data: { isActive: false } });

    await expect(canViewRoom(fixture, fixture.viewerA.id, fixture.roomA1.id)).resolves.toBe(false);
    await expect(listedRoomIds(fixture)).resolves.toEqual([]);
  });

  it('loads groups from the database and denies after group removal or expiry', async () => {
    const fixture = await seedFixture();
    const group = await prisma.group.create({
      data: { organizationId: fixture.orgA.id, name: 'Synthetic Reviewers' },
    });
    const membership = await prisma.groupMembership.create({
      data: { groupId: group.id, userId: fixture.viewerA.id },
    });
    const permission = await prisma.permission.create({
      data: {
        organizationId: fixture.orgA.id,
        resourceType: 'ROOM',
        roomId: fixture.roomA2.id,
        granteeType: 'GROUP',
        groupId: group.id,
        permissionLevel: 'VIEW',
      },
    });

    await expect(canViewRoom(fixture, fixture.viewerA.id, fixture.roomA2.id)).resolves.toBe(true);

    await prisma.groupMembership.delete({ where: { id: membership.id } });
    await expect(canViewRoom(fixture, fixture.viewerA.id, fixture.roomA2.id)).resolves.toBe(false);

    await prisma.groupMembership.create({
      data: { groupId: group.id, userId: fixture.viewerA.id },
    });
    await prisma.permission.update({
      where: { id: permission.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(canViewRoom(fixture, fixture.viewerA.id, fixture.roomA2.id)).resolves.toBe(false);
  });

  it('keeps leaf grants out of discovery and applies document and folder overrides', async () => {
    const fixture = await seedFixture();
    await prisma.permission.create({
      data: {
        organizationId: fixture.orgA.id,
        resourceType: 'DOCUMENT',
        roomId: fixture.roomA3.id,
        folderId: fixture.folderA3.id,
        documentId: fixture.documentA3.id,
        granteeType: 'USER',
        userId: fixture.viewerA.id,
        permissionLevel: 'VIEW',
      },
    });

    const documentResource = {
      type: 'DOCUMENT' as const,
      organizationId: fixture.orgA.id,
      roomId: fixture.roomA3.id,
      folderId: fixture.folderA3.id,
      documentId: fixture.documentA3.id,
    };
    const directDocumentAccess = await withOrgContext(fixture.orgA.id, (tx) =>
      getPermissionEngine().can({ userId: fixture.viewerA.id }, 'view', documentResource, tx)
    );
    expect(directDocumentAccess).toBe(true);
    const secondDocumentAccess = await withOrgContext(fixture.orgA.id, (tx) =>
      getPermissionEngine().can(
        { userId: fixture.viewerA.id },
        'view',
        {
          ...documentResource,
          documentId: fixture.secondDocumentA3.id,
        },
        tx
      )
    );
    expect(secondDocumentAccess).toBe(false);
    await expect(listedRoomIds(fixture)).resolves.toEqual([]);

    await prisma.permission.create({
      data: {
        organizationId: fixture.orgA.id,
        resourceType: 'FOLDER',
        roomId: fixture.roomA3.id,
        folderId: fixture.folderA3.id,
        granteeType: 'USER',
        userId: fixture.viewerA.id,
        permissionLevel: 'VIEW',
      },
    });
    const directFolderAccess = await withOrgContext(fixture.orgA.id, (tx) =>
      getPermissionEngine().can(
        { userId: fixture.viewerA.id },
        'view',
        {
          type: 'FOLDER',
          organizationId: fixture.orgA.id,
          roomId: fixture.roomA3.id,
          folderId: fixture.folderA3.id,
        },
        tx
      )
    );
    expect(directFolderAccess).toBe(true);
    await expect(listedRoomIds(fixture)).resolves.toEqual([]);

    await prisma.permission.createMany({
      data: [
        {
          organizationId: fixture.orgA.id,
          resourceType: 'ROOM',
          roomId: fixture.roomA3.id,
          granteeType: 'USER',
          userId: fixture.viewerA.id,
          permissionLevel: 'VIEW',
        },
        {
          organizationId: fixture.orgA.id,
          resourceType: 'FOLDER',
          roomId: fixture.roomA3.id,
          folderId: fixture.folderA3.id,
          granteeType: 'USER',
          userId: fixture.viewerA.id,
          permissionLevel: 'NONE',
        },
      ],
    });
    const deniedByFolder = await withOrgContext(fixture.orgA.id, (tx) =>
      getPermissionEngine().can({ userId: fixture.viewerA.id }, 'view', documentResource, tx)
    );
    expect(deniedByFolder).toBe(false);
    await expect(listedRoomIds(fixture)).resolves.toEqual([fixture.roomA3.id]);
  });

  it('applies inheritable ancestor-folder allows and denies to nested documents', async () => {
    const fixture = await seedFixture();
    const roomGrant = await prisma.permission.create({
      data: {
        organizationId: fixture.orgA.id,
        resourceType: 'ROOM',
        roomId: fixture.roomA3.id,
        granteeType: 'USER',
        userId: fixture.viewerA.id,
        permissionLevel: 'VIEW',
      },
    });
    const parentDecision = await prisma.permission.create({
      data: {
        organizationId: fixture.orgA.id,
        resourceType: 'FOLDER',
        roomId: fixture.roomA3.id,
        folderId: fixture.folderA3.id,
        granteeType: 'USER',
        userId: fixture.viewerA.id,
        permissionLevel: 'NONE',
        inheritFromParent: true,
      },
    });
    const nestedResource = {
      type: 'DOCUMENT' as const,
      organizationId: fixture.orgA.id,
      roomId: fixture.roomA3.id,
      folderId: fixture.nestedFolderA3.id,
      documentId: fixture.nestedDocumentA3.id,
    };
    const canViewNestedDocument = () =>
      withOrgContext(fixture.orgA.id, (tx) =>
        getPermissionEngine().can({ userId: fixture.viewerA.id }, 'view', nestedResource, tx)
      );

    await expect(canViewNestedDocument()).resolves.toBe(false);

    await prisma.permission.update({
      where: { id: parentDecision.id },
      data: { inheritFromParent: false },
    });
    await expect(canViewNestedDocument()).resolves.toBe(true);

    await prisma.permission.update({
      where: { id: roomGrant.id },
      data: { isActive: false },
    });
    await prisma.permission.update({
      where: { id: parentDecision.id },
      data: { permissionLevel: 'VIEW', inheritFromParent: true },
    });
    await expect(canViewNestedDocument()).resolves.toBe(true);
    await expect(listedRoomIds(fixture)).resolves.toEqual([]);
  });

  it('orders room admin over ACL deny and denies inactive or cross-tenant membership', async () => {
    const fixture = await seedFixture();
    await prisma.permission.create({
      data: {
        organizationId: fixture.orgA.id,
        resourceType: 'ROOM',
        roomId: fixture.roomA2.id,
        granteeType: 'USER',
        userId: fixture.viewerA.id,
        permissionLevel: 'NONE',
      },
    });
    await prisma.roleAssignment.create({
      data: {
        organizationId: fixture.orgA.id,
        userId: fixture.viewerA.id,
        role: 'ADMIN',
        scopeType: 'ROOM',
        roomId: fixture.roomA2.id,
      },
    });

    await expect(canViewRoom(fixture, fixture.viewerA.id, fixture.roomA2.id)).resolves.toBe(true);
    await expect(listedRoomIds(fixture)).resolves.toEqual([fixture.roomA2.id]);

    const crossTenant = await withOrgContext(fixture.orgA.id, (tx) =>
      getPermissionEngine().can(
        { userId: fixture.viewerA.id },
        'view',
        {
          type: 'ROOM',
          organizationId: fixture.orgB.id,
          roomId: fixture.roomB1.id,
        },
        tx
      )
    );
    expect(crossTenant).toBe(false);

    await prisma.userOrganization.update({
      where: {
        organizationId_userId: {
          organizationId: fixture.orgA.id,
          userId: fixture.viewerA.id,
        },
      },
      data: { isActive: false },
    });
    await expect(canViewRoom(fixture, fixture.viewerA.id, fixture.roomA2.id)).resolves.toBe(false);
    await expect(listedRoomIds(fixture)).resolves.toEqual([]);
  });
});
