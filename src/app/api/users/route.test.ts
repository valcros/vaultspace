import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from './route';

vi.mock('@/lib/middleware', () => ({ requireAuthFromRequest: vi.fn() }));
vi.mock('@/lib/db', () => ({ withOrgContext: vi.fn() }));

import { requireAuthFromRequest } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const mockRequireAuthFromRequest = vi.mocked(requireAuthFromRequest);
const mockWithOrgContext = vi.mocked(withOrgContext);

const adminSession = {
  userId: 'admin-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
};

function useTx(tx: Record<string, unknown>) {
  mockWithOrgContext.mockImplementation(async (_orgId, callback) =>
    callback(tx as unknown as Parameters<typeof callback>[0])
  );
}

describe('GET /api/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthFromRequest.mockResolvedValue(
      adminSession as Awaited<ReturnType<typeof requireAuthFromRequest>>
    );
  });

  it('returns only active organization memberships in the main roster', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        role: 'VIEWER',
        isActive: true,
        archivedAt: null,
        archivedByUserId: null,
        archiveReason: null,
        user: {
          id: 'user-1',
          email: 'viewer@example.com',
          firstName: 'Viewer',
          lastName: 'One',
          createdAt: new Date('2026-01-01'),
          lastLoginAt: null,
          isActive: true,
        },
      },
    ]);
    const invitationFindMany = vi.fn().mockResolvedValue([]);
    const linkFindMany = vi.fn().mockResolvedValue([]);
    useTx({
      userOrganization: { findMany },
      invitation: { findMany: invitationFindMany },
      link: { findMany: linkFindMany },
    });

    const response = await GET(new NextRequest('http://localhost/api/users'));

    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          isActive: true,
          user: { isActive: true },
        }),
      })
    );
    expect(invitationFindMany).toHaveBeenCalledOnce();
    expect(linkFindMany).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      users: [
        {
          id: 'user-1',
          isActive: true,
          lifecycleStatus: 'ACTIVE',
        },
      ],
    });
  });

  it('returns archived memberships only in the archived view and excludes invitations', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        role: 'VIEWER',
        isActive: false,
        archivedAt: new Date('2026-08-21T12:00:00.000Z'),
        archivedByUserId: 'admin-1',
        archiveReason: null,
        user: {
          id: 'user-2',
          email: 'former@example.com',
          firstName: 'Former',
          lastName: 'Member',
          createdAt: new Date('2026-01-01'),
          lastLoginAt: new Date('2026-08-01'),
          isActive: true,
        },
      },
    ]);
    const invitationFindMany = vi.fn();
    const linkFindMany = vi.fn();
    useTx({
      userOrganization: { findMany },
      invitation: { findMany: invitationFindMany },
      link: { findMany: linkFindMany },
    });

    const response = await GET(new NextRequest('http://localhost/api/users?view=archived'));

    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          OR: [{ isActive: false }, { user: { isActive: false } }],
        },
      })
    );
    expect(invitationFindMany).not.toHaveBeenCalled();
    expect(linkFindMany).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      users: [
        {
          id: 'user-2',
          isActive: false,
          lifecycleStatus: 'ARCHIVED_MEMBERSHIP',
          archivedByUserId: 'admin-1',
        },
      ],
      pendingInvitations: [],
      viewerLinkInvites: [],
    });
  });

  it('rejects an unsupported view before querying organization data', async () => {
    const response = await GET(new NextRequest('http://localhost/api/users?view=all'));

    expect(response.status).toBe(400);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });
});
