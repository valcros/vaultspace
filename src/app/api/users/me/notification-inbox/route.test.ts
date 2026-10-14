import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  withOrgContext: vi.fn(),
  viewerRequests: vi.fn(),
}));
vi.mock('@/lib/middleware', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));
vi.mock('@/lib/middleware/rateLimit', () => ({
  rateLimiters: { viewerRequests: mocks.viewerRequests },
}));

import { GET, PATCH } from './route';

function transaction() {
  return {
    userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
    notification: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'notification-1',
          type: 'ACCESS_REQUEST',
          title: 'New request',
          message: 'Review it',
          actionPath: '/rooms/room-1?manage=members',
          isRead: false,
          createdAt: new Date('2026-10-14T00:00:00Z'),
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('current membership notification inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: 'user-1', organizationId: 'org-1' });
  });

  it('lists only the active membership and returns a stable page', async () => {
    const tx = transaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    const response = await GET(new NextRequest('http://localhost/api/users/me/notification-inbox'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: 'notification-1',
          type: 'ACCESS_REQUEST',
          title: 'New request',
          message: 'Review it',
          actionPath: '/rooms/room-1?manage=members',
          isRead: false,
          createdAt: '2026-10-14T00:00:00.000Z',
        },
      ],
      unreadCount: 1,
      nextCursor: null,
    });
    expect(tx.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', userOrganizationId: 'membership-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      })
    );
  });

  it('rejects a cursor that belongs to another member', async () => {
    const tx = transaction();
    tx.notification.findFirst.mockResolvedValue(null);
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    const response = await GET(
      new NextRequest('http://localhost/api/users/me/notification-inbox?cursor=other-notification')
    );
    expect(response.status).toBe(400);
    expect(tx.notification.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'other-notification',
        organizationId: 'org-1',
        userOrganizationId: 'membership-1',
      },
      select: { id: true, createdAt: true },
    });
    expect(tx.notification.findMany).not.toHaveBeenCalled();
  });

  it('scopes read-state changes to the current member and organization', async () => {
    const tx = transaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    const response = await PATCH(
      new NextRequest('http://localhost/api/users/me/notification-inbox', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notificationId: 'notification-1',
          organizationId: 'org-2',
          userOrganizationId: 'membership-2',
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        userOrganizationId: 'membership-1',
        isRead: false,
        id: 'notification-1',
      },
      data: { isRead: true },
    });
  });

  it('does not query notifications for an inactive membership', async () => {
    const tx = transaction();
    tx.userOrganization.findFirst.mockResolvedValue(null);
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    const response = await GET(new NextRequest('http://localhost/api/users/me/notification-inbox'));
    expect(response.status).toBe(403);
    expect(tx.notification.findMany).not.toHaveBeenCalled();
  });
});
