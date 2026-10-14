import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const can = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/lib/permissions', () => ({ getPermissionEngine: () => ({ can }) }));

import { notifyQuestionAsker, notifyRoomAdministrators } from './InAppNotificationService';

function transaction() {
  return {
    roleAssignment: { findMany: vi.fn().mockResolvedValue([{ userId: 'room-admin' }]) },
    userOrganization: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'membership-actor', userId: 'actor' },
        { id: 'membership-org-admin', userId: 'org-admin' },
        { id: 'membership-room-admin', userId: 'room-admin' },
      ]),
      findFirst: vi.fn().mockResolvedValue({ id: 'membership-asker', role: 'VIEWER' }),
    },
    notification: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
}

describe('in-app notification producers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockResolvedValue(true);
  });

  it('selects active organization and room administrators and excludes the actor', async () => {
    const tx = transaction();
    const count = await notifyRoomAdministrators(tx as unknown as Prisma.TransactionClient, {
      organizationId: 'org-1',
      roomId: 'room-1',
      sourceEventId: 'event-1',
      actorUserId: 'actor',
      type: 'UPLOAD_COMPLETE',
      title: 'New document',
      message: 'Open the room.',
      actionPath: '/rooms/room-1',
    });

    expect(count).toBe(2);
    expect(tx.userOrganization.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: 'org-1',
        isActive: true,
        archivedAt: null,
        user: { isActive: true },
        OR: [{ role: 'ADMIN' }, { userId: { in: ['room-admin'] } }],
      }),
      select: { id: true, userId: true },
    });
    expect(tx.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userOrganizationId: 'membership-org-admin',
          sourceEventId: 'event-1',
        }),
        expect.objectContaining({
          userOrganizationId: 'membership-room-admin',
          sourceEventId: 'event-1',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('does not notify a question asker without an active member account', async () => {
    const tx = transaction();
    tx.userOrganization.findFirst.mockResolvedValue(null);
    const count = await notifyQuestionAsker(tx as unknown as Prisma.TransactionClient, {
      organizationId: 'org-1',
      roomId: 'room-1',
      sourceEventId: 'event-2',
      askerUserId: 'former-member',
      actorUserId: 'admin',
    });
    expect(count).toBe(0);
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('does not notify a question asker after room access is revoked', async () => {
    const tx = transaction();
    can.mockResolvedValue(false);
    const count = await notifyQuestionAsker(tx as unknown as Prisma.TransactionClient, {
      organizationId: 'org-1',
      roomId: 'room-1',
      sourceEventId: 'event-3',
      askerUserId: 'member-1',
      actorUserId: 'admin',
    });
    expect(count).toBe(0);
    expect(can).toHaveBeenCalledWith(
      { userId: 'member-1', role: 'VIEWER' },
      'view',
      { type: 'ROOM', organizationId: 'org-1', roomId: 'room-1' },
      tx
    );
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });
});
