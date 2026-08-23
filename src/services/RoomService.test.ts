/**
 * RoomService Unit Tests
 *
 * Tests room lifecycle: creation, listing, updating, status changes.
 * Mocks database and event bus - no real DB connection needed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthorizationError } from '@/lib/errors';

import { RoomService } from './RoomService';
import type { ServiceContext } from './types';

const mockGetViewableRoomIds = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockCan = vi.hoisted(() => vi.fn().mockResolvedValue(true));

// Mock dependencies
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

vi.mock('@/lib/permissions', () => ({
  getPermissionEngine: vi.fn(() => ({
    can: mockCan,
    getViewableRoomIds: mockGetViewableRoomIds,
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
  document: {
    findMany: vi.fn(),
    update: vi.fn(),
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
    mockGetViewableRoomIds.mockResolvedValue(null);
    mockCan.mockResolvedValue(true);
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

    it('hides a draft room from an ordinary viewer even when a legacy view grant exists', async () => {
      const viewerContext = createMockContext({
        session: {
          ...ctx.session,
          organization: { ...ctx.session.organization, role: 'VIEWER' },
        },
      });
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'DRAFT',
        _count: { documents: 0, folders: 0, links: 0, permissions: 1 },
      });
      mockCan.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(service.getById(viewerContext, 'room-1')).resolves.toBeNull();
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

    it('applies authorized room IDs before count and pagination for non-admins', async () => {
      mockGetViewableRoomIds.mockResolvedValue(new Set(['room-allowed']));
      mockTx.room.count.mockResolvedValue(1);
      mockTx.room.findMany.mockResolvedValue([{ id: 'room-allowed' }]);

      const result = await service.list(ctx, { status: 'ARCHIVED', offset: 0, limit: 1 });

      expect(result.total).toBe(1);
      const expectedWhere = expect.objectContaining({
        organizationId: 'org-1',
        id: { in: ['room-allowed'] },
        status: 'ACTIVE',
      });
      expect(mockTx.room.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(mockTx.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere, skip: 0, take: 1 })
      );
    });

    it('returns an empty authorized page without falling back to organization scope', async () => {
      mockGetViewableRoomIds.mockResolvedValue(new Set());
      mockTx.room.count.mockResolvedValue(0);
      mockTx.room.findMany.mockResolvedValue([]);

      const result = await service.list(ctx);

      expect(result.items).toEqual([]);
      expect(mockTx.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: [] }, status: 'ACTIVE' }),
        })
      );
    });
  });

  describe('changeStatus', () => {
    it('validates a requested lifecycle transition before committing combined settings', async () => {
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'DRAFT',
      });

      await expect(
        service.update(ctx, 'room-1', { name: 'Should not persist', status: 'ARCHIVED' })
      ).rejects.toThrow('Cannot transition from DRAFT to ARCHIVED');

      expect(mockTx.room.update).not.toHaveBeenCalled();
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('publishes a draft atomically with lifecycle audit evidence', async () => {
      const publishedRoom = {
        id: 'room-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        archivedAt: null,
        closedAt: null,
      };
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'DRAFT',
      });
      mockTx.room.update.mockResolvedValue(publishedRoom);

      await expect(service.changeStatus(ctx, 'room-1', 'ACTIVE')).resolves.toEqual(publishedRoom);

      expect(mockTx.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'ACTIVE' },
      });
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ROOM_STATUS_CHANGED',
        expect.objectContaining({
          roomId: 'room-1',
          metadata: { previousStatus: 'DRAFT', newStatus: 'ACTIVE' },
        }),
        mockTx
      );
    });

    it('sets and clears archivedAt through the canonical lifecycle path', async () => {
      mockTx.room.findFirst.mockResolvedValueOnce({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
      });
      mockTx.room.update.mockResolvedValueOnce({ id: 'room-1', status: 'ARCHIVED' });

      await service.changeStatus(ctx, 'room-1', 'ARCHIVED');
      expect(mockTx.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.objectContaining({ status: 'ARCHIVED', archivedAt: expect.any(Date) }),
      });

      mockTx.room.findFirst.mockResolvedValueOnce({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'ARCHIVED',
      });
      mockTx.room.update.mockResolvedValueOnce({ id: 'room-1', status: 'ACTIVE' });

      await service.changeStatus(ctx, 'room-1', 'ACTIVE');
      expect(mockTx.room.update).toHaveBeenLastCalledWith({
        where: { id: 'room-1' },
        data: { status: 'ACTIVE', archivedAt: null },
      });
    });

    it('rejects forbidden transitions before mutating or emitting an event', async () => {
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'DRAFT',
      });

      await expect(service.changeStatus(ctx, 'room-1', 'ARCHIVED')).rejects.toThrow(
        'Cannot transition from DRAFT to ARCHIVED'
      );
      expect(mockTx.room.update).not.toHaveBeenCalled();
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('does not let a room-scoped viewer publish or close a room', async () => {
      const viewerContext = createMockContext({
        session: {
          ...ctx.session,
          organization: { ...ctx.session.organization, role: 'VIEWER' },
        },
      });

      await expect(service.changeStatus(viewerContext, 'room-1', 'ACTIVE')).rejects.toBeInstanceOf(
        AuthorizationError
      );
      expect(mockTx.room.findFirst).not.toHaveBeenCalled();
    });

    it('redacts a password hash from room mutation results and audit metadata', async () => {
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        passwordHash: 'existing-secret-hash',
      });
      mockTx.room.update.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        passwordHash: 'replacement-secret-hash',
      });

      const result = await service.update(ctx, 'room-1', {
        requiresPassword: true,
        passwordHash: 'replacement-secret-hash',
      });

      expect(result).not.toHaveProperty('passwordHash');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ROOM_UPDATED',
        expect.objectContaining({
          metadata: { changes: { requiresPassword: true } },
        }),
        mockTx
      );
    });

    it('closes through the canonical lifecycle method when the legacy delete API is used', async () => {
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
      });
      mockTx.room.update.mockResolvedValue({ id: 'room-1', status: 'CLOSED' });

      await service.delete(ctx, 'room-1');

      expect(mockTx.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.objectContaining({ status: 'CLOSED', closedAt: expect.any(Date) }),
      });
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ROOM_CLOSED',
        expect.objectContaining({ roomId: 'room-1' }),
        mockTx
      );
    });
  });

  describe('enableAccessionNumbering', () => {
    it('enables numbering and backfills documents in curated order', async () => {
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        accessionPrefix: null,
        lastAccessionSeq: 0,
      });
      // Intentionally out of order to prove the service sorts before numbering.
      mockTx.document.findMany.mockResolvedValue([
        { id: 'd-corp', name: '1.01 Corporate.pdf', folder: { path: '/1. Corporate' } },
        { id: 'd-start', name: '00.00 Index.pdf', folder: { path: '/00. Start Here' } },
      ]);
      mockTx.document.update.mockResolvedValue({});
      mockTx.room.update.mockResolvedValue({});

      const result = await service.enableAccessionNumbering(ctx, 'room-1', {
        prefix: 'bsd',
        backfill: true,
      });

      expect(result).toEqual({ prefix: 'BSD', assigned: 2, lastAccessionSeq: 2 });
      // Start Here sorts first, so it gets BSD-0001.
      expect(mockTx.document.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'd-start' },
        data: { accessionNumber: 'BSD-0001', accessionSeq: 1 },
      });
      expect(mockTx.document.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'd-corp' },
        data: { accessionNumber: 'BSD-0002', accessionSeq: 2 },
      });
      expect(mockTx.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { accessionNumberingEnabled: true, accessionPrefix: 'BSD', lastAccessionSeq: 2 },
      });
    });

    it('enables without backfill when backfill is false', async () => {
      mockTx.room.findFirst.mockResolvedValue({
        id: 'room-1',
        organizationId: 'org-1',
        accessionPrefix: 'BSD',
        lastAccessionSeq: 5,
      });
      mockTx.room.update.mockResolvedValue({});

      const result = await service.enableAccessionNumbering(ctx, 'room-1', { backfill: false });

      expect(result).toEqual({ prefix: 'BSD', assigned: 0, lastAccessionSeq: 5 });
      expect(mockTx.document.findMany).not.toHaveBeenCalled();
      expect(mockTx.document.update).not.toHaveBeenCalled();
    });
  });
});
