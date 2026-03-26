/**
 * RoomService Unit Tests
 *
 * Tests room lifecycle: creation, listing, updating, status changes.
 * Mocks database and event bus - no real DB connection needed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomService } from './RoomService';
import type { ServiceContext } from './types';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

vi.mock('@/lib/permissions', () => ({
  getPermissionEngine: vi.fn(() => ({
    can: vi.fn().mockResolvedValue(true),
  })),
}));

// Mock transaction
const mockTx = {
  room: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
};

// Mock event bus
const mockEventBus = {
  emit: vi.fn().mockResolvedValue(undefined),
};

// Helper to create service context
function createMockContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
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
        role: 'ADMIN' as const,
        canManageUsers: true,
        canManageRooms: true,
      },
      expiresAt: new Date(Date.now() + 86400000),
      issuedAt: new Date(),
    },
    requestId: 'req-test-1',
    eventBus: mockEventBus as unknown as ServiceContext['eventBus'],
    providers: {} as ServiceContext['providers'],
    ...overrides,
  };
}

describe('RoomService', () => {
  let service: RoomService;
  let ctx: ServiceContext;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoomService();
    ctx = createMockContext();
  });

  describe('create', () => {
    it('should create a room with valid name', async () => {
      const mockRoom = {
        id: 'room-1',
        organizationId: 'org-1',
        name: 'Series A Funding',
        slug: 'series-a-funding',
        description: null,
        status: 'DRAFT',
        createdByUserId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockTx.room.findFirst.mockResolvedValue(null); // No slug conflict
      mockTx.room.create.mockResolvedValue(mockRoom);

      const result = await service.create(ctx, { name: 'Series A Funding' });

      expect(result).toEqual(mockRoom);
      expect(mockTx.room.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            name: 'Series A Funding',
            createdByUserId: 'user-1',
          }),
        })
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ROOM_CREATED',
        expect.objectContaining({
          roomId: 'room-1',
        })
      );
    });

    it('should reject empty room name', async () => {
      await expect(service.create(ctx, { name: '' })).rejects.toThrow('Room name is required');
    });

    it('should reject room name over 255 characters', async () => {
      const longName = 'a'.repeat(256);
      await expect(service.create(ctx, { name: longName })).rejects.toThrow(
        'Room name must be 255 characters or less'
      );
    });

    it('should generate unique slug when conflict exists', async () => {
      mockTx.room.findFirst
        .mockResolvedValueOnce({ id: 'existing' }) // First slug taken
        .mockResolvedValueOnce(null); // Second slug available

      mockTx.room.create.mockResolvedValue({
        id: 'room-2',
        slug: 'my-room-1',
        name: 'My Room',
        organizationId: 'org-1',
        status: 'DRAFT',
      });

      await service.create(ctx, { name: 'My Room' });

      expect(mockTx.room.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should set status to DRAFT by default', async () => {
      mockTx.room.findFirst.mockResolvedValue(null);
      mockTx.room.create.mockResolvedValue({ id: 'room-3', status: 'DRAFT' });

      await service.create(ctx, { name: 'Test Room' });

      expect(mockTx.room.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DRAFT',
          }),
        })
      );
    });
  });

  describe('getById', () => {
    it('should return room with stats when found and authorized', async () => {
      const mockRoom = {
        id: 'room-1',
        organizationId: 'org-1',
        name: 'Test Room',
        _count: { documents: 5, folders: 2, links: 1 },
      };

      mockTx.room.findFirst.mockResolvedValue(mockRoom);

      const result = await service.getById(ctx, 'room-1');

      expect(result).toEqual(mockRoom);
      expect(mockTx.room.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'room-1',
            organizationId: 'org-1',
          },
        })
      );
    });

    it('should return null when room not found', async () => {
      mockTx.room.findFirst.mockResolvedValue(null);

      const result = await service.getById(ctx, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return paginated rooms', async () => {
      const rooms = [
        { id: 'r1', name: 'Room 1', _count: { documents: 0, folders: 0, links: 0 } },
        { id: 'r2', name: 'Room 2', _count: { documents: 3, folders: 1, links: 2 } },
      ];

      mockTx.room.count.mockResolvedValue(2);
      mockTx.room.findMany.mockResolvedValue(rooms);

      const result = await service.list(ctx);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by status', async () => {
      mockTx.room.count.mockResolvedValue(0);
      mockTx.room.findMany.mockResolvedValue([]);

      await service.list(ctx, { status: 'ACTIVE' as const });

      expect(mockTx.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
          }),
        })
      );
    });

    it('should filter by search term', async () => {
      mockTx.room.count.mockResolvedValue(0);
      mockTx.room.findMany.mockResolvedValue([]);

      await service.list(ctx, { search: 'funding' });

      expect(mockTx.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: { contains: 'funding', mode: 'insensitive' } }),
            ]),
          }),
        })
      );
    });

    it('should respect pagination parameters', async () => {
      mockTx.room.count.mockResolvedValue(100);
      mockTx.room.findMany.mockResolvedValue([{ id: 'r1' }]);

      const result = await service.list(ctx, { offset: 10, limit: 1 });

      expect(result.offset).toBe(10);
      expect(result.limit).toBe(1);
      expect(result.hasMore).toBe(true);
      expect(mockTx.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 1,
        })
      );
    });

    it('should always scope to organization', async () => {
      mockTx.room.count.mockResolvedValue(0);
      mockTx.room.findMany.mockResolvedValue([]);

      await service.list(ctx);

      expect(mockTx.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
          }),
        })
      );
    });
  });
});
