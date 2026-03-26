/**
 * GroupService Unit Tests
 *
 * Tests group lifecycle: creation, listing, member management.
 * Mocks database and event bus.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupService } from './GroupService';
import type { ServiceContext } from './types';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

// Mock transaction
const mockTx = {
  group: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  groupMembership: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

const mockEventBus = {
  emit: vi.fn().mockResolvedValue(undefined),
};

function createMockContext(role: 'ADMIN' | 'VIEWER' = 'ADMIN'): ServiceContext {
  return {
    session: {
      sessionId: 'sess-1',
      userId: 'user-1',
      organizationId: 'org-1',
      user: {
        id: 'user-1',
        email: 'admin@test.com',
        firstName: 'Test',
        lastName: 'Admin',
        isActive: true,
      },
      organization: {
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        role,
        canManageUsers: role === 'ADMIN',
        canManageRooms: role === 'ADMIN',
      },
      expiresAt: new Date(Date.now() + 86400000),
      issuedAt: new Date(),
    },
    requestId: 'req-test-1',
    eventBus: mockEventBus as unknown as ServiceContext['eventBus'],
    providers: {} as ServiceContext['providers'],
  };
}

describe('GroupService', () => {
  let service: GroupService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GroupService();
  });

  describe('create', () => {
    it('should create a group with valid name', async () => {
      const ctx = createMockContext('ADMIN');
      const mockGroup = {
        id: 'grp-1',
        organizationId: 'org-1',
        name: 'Investors',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockTx.group.findFirst.mockResolvedValue(null); // No duplicate
      mockTx.group.create.mockResolvedValue(mockGroup);

      const result = await service.create(ctx, { name: 'Investors' });

      expect(result).toEqual(mockGroup);
      expect(mockTx.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            name: 'Investors',
          }),
        })
      );
      expect(mockEventBus.emit).toHaveBeenCalled();
    });

    it('should reject empty group name', async () => {
      const ctx = createMockContext('ADMIN');
      await expect(service.create(ctx, { name: '' })).rejects.toThrow('Group name is required');
    });

    it('should reject group name over 100 characters', async () => {
      const ctx = createMockContext('ADMIN');
      await expect(service.create(ctx, { name: 'a'.repeat(101) })).rejects.toThrow(
        'Group name must be 100 characters or less'
      );
    });

    it('should reject non-admin users', async () => {
      const ctx = createMockContext('VIEWER');
      await expect(service.create(ctx, { name: 'Test' })).rejects.toThrow(
        'Only admins can create groups'
      );
    });

    it('should reject duplicate group names', async () => {
      const ctx = createMockContext('ADMIN');
      mockTx.group.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.create(ctx, { name: 'Existing Group' })).rejects.toThrow(
        'A group with this name already exists'
      );
    });
  });

  describe('list', () => {
    it('should return paginated groups', async () => {
      const ctx = createMockContext();
      const groups = [
        { id: 'g1', name: 'Investors', _count: { memberships: 3 } },
        { id: 'g2', name: 'Legal', _count: { memberships: 1 } },
      ];

      mockTx.group.count.mockResolvedValue(2);
      mockTx.group.findMany.mockResolvedValue(groups);

      const result = await service.list(ctx);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by search term', async () => {
      const ctx = createMockContext();
      mockTx.group.count.mockResolvedValue(0);
      mockTx.group.findMany.mockResolvedValue([]);

      await service.list(ctx, { search: 'invest' });

      expect(mockTx.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
          }),
        })
      );
    });
  });
});
