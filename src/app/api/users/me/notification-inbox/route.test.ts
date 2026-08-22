import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db', () => ({ withOrgContext: vi.fn() }));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { GET, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

describe('notification inbox API', () => {
  const session = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'VIEWER' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(session as never);
  });

  it('lists only the authenticated active membership inbox without exposing ownership ids', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'notice-1',
        type: 'ADMIN_ACTION',
        title: 'Welcome',
        message: 'Ready',
        isRead: false,
        createdAt: new Date('2026-08-21T10:00:00.000Z'),
      },
    ]);
    mockWithOrgContext.mockImplementation(async (_orgId, callback) =>
      callback({
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
        notification: { findMany, count: vi.fn().mockResolvedValue(1) },
      } as never)
    );

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: 'notice-1',
          type: 'ADMIN_ACTION',
          title: 'Welcome',
          message: 'Ready',
          isRead: false,
          createdAt: '2026-08-21T10:00:00.000Z',
        },
      ],
      unreadCount: 1,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', userOrganizationId: 'membership-1' },
      })
    );
  });

  it('marks only a notification owned by the derived membership as read', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    mockWithOrgContext.mockImplementation(async (_orgId, callback) =>
      callback({
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
        notification: { updateMany, count: vi.fn().mockResolvedValue(2) },
      } as never)
    );
    const response = await PATCH(
      new NextRequest('http://localhost/api/users/me/notification-inbox', {
        method: 'PATCH',
        body: JSON.stringify({ notificationId: 'other-member-notice' }),
      })
    );
    expect(response.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        userOrganizationId: 'membership-1',
        isRead: false,
        id: 'other-member-notice',
      },
      data: { isRead: true },
    });
    expect(await response.json()).toEqual({ updated: 0, unreadCount: 2 });
  });
});
