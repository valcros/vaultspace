import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getViewableRoomIds: vi.fn(),
  can: vi.fn(),
}));

const mockTx = {
  userOrganization: { findUnique: vi.fn() },
  userDashboardLayout: { findUnique: vi.fn(), update: vi.fn() },
  question: { findMany: vi.fn() },
  accessRequest: { count: vi.fn(), findFirst: vi.fn() },
  message: { count: vi.fn(), findMany: vi.fn() },
  room: { findMany: vi.fn() },
  roleAssignment: { findMany: vi.fn() },
  document: { groupBy: vi.fn() },
  bookmark: { findMany: vi.fn() },
  pageView: { findMany: vi.fn() },
  folder: { findMany: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

vi.mock('@/lib/permissions', () => ({
  getPermissionEngine: () => ({
    getViewableRoomIds: mocks.getViewableRoomIds,
    can: mocks.can,
  }),
}));

import { getDashboardData } from './dashboard-data';

describe('dashboard room-scoped authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.userOrganization.findUnique.mockResolvedValue({
      role: 'VIEWER',
      isActive: true,
      user: {
        id: 'viewer-1',
        firstName: 'Synthetic',
        lastName: 'Viewer',
        email: 'viewer@example.test',
        lastLoginAt: null,
      },
    });
    mockTx.userDashboardLayout.findUnique.mockResolvedValue(null);
    mockTx.question.findMany.mockResolvedValue([]);
    mockTx.message.count.mockResolvedValue(0);
    mockTx.message.findMany.mockResolvedValue([]);
    mockTx.room.findMany.mockResolvedValue([]);
    mockTx.roleAssignment.findMany.mockResolvedValue([]);
    mockTx.bookmark.findMany.mockResolvedValue([]);
    mockTx.pageView.findMany.mockResolvedValue([]);
    mockTx.folder.findMany.mockResolvedValue([]);
    mocks.getViewableRoomIds.mockResolvedValue(new Set(['room-allowed']));
    mocks.can.mockResolvedValue(false);
  });

  it('applies authorized room IDs to every viewer discovery widget', async () => {
    const result = await getDashboardData({ organizationId: 'org-1', userId: 'viewer-1' });

    expect(result.myRooms).toEqual([]);
    expect(mockTx.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          id: { in: ['room-allowed'] },
          status: 'ACTIVE',
        }),
      })
    );
    expect(mockTx.bookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', userId: 'viewer-1' },
      })
    );
    expect(mockTx.question.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roomId: { in: ['room-allowed'] } }),
      })
    );
    expect(mockTx.pageView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', userId: 'viewer-1' },
      })
    );
    expect(mockTx.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ roomId: null }, { roomId: { in: ['room-allowed'] } }],
        }),
      })
    );
  });

  it('keeps an explicitly authorized leaf bookmark without discovering its room', async () => {
    mocks.getViewableRoomIds.mockResolvedValue(new Set());
    mocks.can.mockResolvedValue(true);
    mockTx.bookmark.findMany.mockResolvedValue([
      {
        id: 'bookmark-1',
        createdAt: new Date('2026-08-11T00:00:00Z'),
        document: {
          id: 'document-1',
          name: 'Synthetic document',
          folderId: 'folder-1',
          folder: { name: 'Synthetic folder' },
        },
        room: { id: 'room-leaf', name: 'Leaf room' },
      },
    ]);

    const result = await getDashboardData({ organizationId: 'org-1', userId: 'viewer-1' });

    expect(result.myRooms).toEqual([]);
    expect(result.bookmarks).toEqual([
      expect.objectContaining({ documentId: 'document-1', roomId: 'room-leaf' }),
    ]);
  });

  it('filters denied bookmark and history documents from a viewable room', async () => {
    mockTx.bookmark.findMany.mockResolvedValue([
      {
        id: 'bookmark-denied',
        createdAt: new Date('2026-08-11T00:00:00Z'),
        document: {
          id: 'document-denied',
          name: 'Denied document',
          folderId: 'folder-denied',
          folder: { name: 'Denied folder' },
        },
        room: { id: 'room-allowed', name: 'Allowed room' },
      },
    ]);
    mockTx.pageView.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-08-11T00:00:00Z'),
        pageNumber: 3,
        document: {
          id: 'document-denied',
          name: 'Denied document',
          folderId: 'folder-denied',
        },
        room: { id: 'room-allowed', name: 'Allowed room' },
      },
    ]);
    mocks.can.mockResolvedValue(false);

    const result = await getDashboardData({ organizationId: 'org-1', userId: 'viewer-1' });

    expect(result.bookmarks).toEqual([]);
    expect(result.continueReading).toEqual([]);
    expect(mocks.can).toHaveBeenCalledTimes(2);
  });

  it('limits admin action items to live rooms', async () => {
    mocks.getViewableRoomIds.mockResolvedValue(null);
    mockTx.userOrganization.findUnique.mockResolvedValue({
      role: 'ADMIN',
      isActive: true,
      user: {
        id: 'admin-1',
        firstName: 'Synthetic',
        lastName: 'Admin',
        email: 'admin@example.test',
        lastLoginAt: null,
      },
    });
    mockTx.accessRequest.count.mockResolvedValue(0);
    mockTx.accessRequest.findFirst.mockResolvedValue(null);

    const result = await getDashboardData({ organizationId: 'org-1', userId: 'admin-1' });

    expect(result.actionRequired?.totalCount).toBe(0);
    expect(mockTx.question.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', status: 'OPEN', room: { status: 'ACTIVE' } },
      })
    );
    expect(mockTx.accessRequest.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', status: 'PENDING', room: { status: 'ACTIVE' } },
    });
    expect(mockTx.accessRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', status: 'PENDING', room: { status: 'ACTIVE' } },
      })
    );
  });
});
