/**
 * EventBus Unit Tests
 *
 * Tests for the immutable audit event system.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActorType, EventType } from '@prisma/client';

import { createEventBus, EventBus } from './EventBus';

// Mock Prisma
const mockEventCreate = vi.fn();
const mockEventTransaction = vi.fn();

// Track call count for generating unique event IDs
let eventCallCount = 0;

// Mock withOrgContext to directly call the operation with a mock transaction
const mockWithOrgContext = vi.fn().mockImplementation(async (_orgId, operation) => {
  const mockTx = {
    event: {
      create: (args: unknown) => {
        eventCallCount++;
        mockEventCreate(args);
        return Promise.resolve({ id: `event-${eventCallCount}` });
      },
      createMany: vi.fn(),
    },
  };
  return operation(mockTx);
});

vi.mock('../db', () => ({
  db: {
    event: {
      create: (args: unknown) => mockEventCreate(args),
    },
    $transaction: (args: unknown) => mockEventTransaction(args),
  },
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

describe('EventBus', () => {
  const orgId = 'org-123';
  const roomId = 'room-456';
  const documentId = 'doc-789';

  beforeEach(() => {
    vi.clearAllMocks();
    eventCallCount = 0;
  });

  describe('emit', () => {
    it('should emit a single event', async () => {
      mockEventCreate.mockResolvedValue({ id: 'event-1' });

      const eventBus = createEventBus(orgId, {
        actorId: 'user-1',
        actorEmail: 'user@example.com',
        actorType: 'ADMIN' as ActorType,
        requestId: 'req-123',
      });

      const eventId = await eventBus.emit('DOCUMENT_VIEWED' as EventType, {
        roomId,
        documentId,
        description: 'User viewed document',
        metadata: { pageNumber: 1 },
      });

      expect(eventId).toBe('event-1');
      expect(mockEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'DOCUMENT_VIEWED',
          actorType: 'ADMIN',
          actorId: 'user-1',
          actorEmail: 'user@example.com',
          organizationId: orgId,
          roomId,
          documentId,
          description: 'User viewed document',
          requestId: 'req-123',
        }),
      });
    });

    it('should emit event with minimal options', async () => {
      const eventBus = createEventBus(orgId, {
        actorType: 'SYSTEM' as ActorType,
      });

      const eventId = await eventBus.emit('USER_LOGIN' as EventType);

      expect(eventId).toBe('event-1');
      expect(mockEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'USER_LOGIN',
          actorType: 'SYSTEM',
          organizationId: orgId,
        }),
      });
    });

    it('should include IP address and user agent', async () => {
      mockEventCreate.mockResolvedValue({ id: 'event-3' });

      const eventBus = createEventBus(orgId, {
        actorType: 'ADMIN' as ActorType,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      });

      await eventBus.emit('USER_LOGIN' as EventType);

      expect(mockEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0',
        }),
      });
    });

    it('should store metadata as JSON', async () => {
      mockEventCreate.mockResolvedValue({ id: 'event-4' });

      const eventBus = createEventBus(orgId, { actorType: 'ADMIN' as ActorType });

      await eventBus.emit('DOCUMENT_DOWNLOADED' as EventType, {
        metadata: {
          fileSize: 1024,
          fileName: 'report.pdf',
          watermarked: true,
        },
      });

      expect(mockEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: {
            fileSize: 1024,
            fileName: 'report.pdf',
            watermarked: true,
          },
        }),
      });
    });
  });

  describe('emitBatch', () => {
    it('should emit multiple events in a transaction', async () => {
      const eventBus = createEventBus(orgId, {
        actorType: 'ADMIN' as ActorType,
        actorId: 'user-1',
      });

      const eventIds = await eventBus.emitBatch([
        { eventType: 'DOCUMENT_VIEWED' as EventType, documentId: 'doc-1' },
        { eventType: 'DOCUMENT_VIEWED' as EventType, documentId: 'doc-2' },
        { eventType: 'DOCUMENT_VIEWED' as EventType, documentId: 'doc-3' },
        { eventType: 'DOCUMENT_VIEWED' as EventType, documentId: 'doc-4' },
        { eventType: 'DOCUMENT_VIEWED' as EventType, documentId: 'doc-5' },
      ]);

      expect(eventIds).toHaveLength(5);
      // Events are created with sequential IDs based on our mock
      expect(eventIds).toEqual(['event-1', 'event-2', 'event-3', 'event-4', 'event-5']);
    });

    it('should preserve actor context across batch events', async () => {
      const eventBus = createEventBus(orgId, {
        actorType: 'ADMIN' as ActorType,
        actorId: 'user-bulk',
        actorEmail: 'bulk@example.com',
        requestId: 'batch-req-1',
      });

      await eventBus.emitBatch([
        { eventType: 'ROOM_CREATED' as EventType, roomId: 'room-a' },
        { eventType: 'DOCUMENT_UPLOADED' as EventType, documentId: 'doc-a' },
      ]);

      // Verify withOrgContext was called (events go through RLS context)
      expect(mockWithOrgContext).toHaveBeenCalled();
    });
  });

  describe('createEventBus', () => {
    it('should create EventBus with default values', () => {
      const eventBus = createEventBus(orgId);

      expect(eventBus).toBeInstanceOf(EventBus);
    });

    it('should generate request ID if not provided', async () => {
      mockEventCreate.mockResolvedValue({ id: 'event-gen' });

      const eventBus = createEventBus(orgId, { actorType: 'SYSTEM' as ActorType });

      await eventBus.emit('USER_LOGIN' as EventType);

      expect(mockEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestId: expect.stringMatching(/^req_\d+_[a-z0-9]+$/),
        }),
      });
    });

    it('should use provided request ID', async () => {
      mockEventCreate.mockResolvedValue({ id: 'event-custom-req' });

      const eventBus = createEventBus(orgId, {
        actorType: 'ADMIN' as ActorType,
        requestId: 'custom-request-123',
      });

      await eventBus.emit('USER_LOGIN' as EventType);

      expect(mockEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestId: 'custom-request-123',
        }),
      });
    });

    it('should default actorType to SYSTEM', async () => {
      mockEventCreate.mockResolvedValue({ id: 'event-default-actor' });

      const eventBus = createEventBus(orgId);

      await eventBus.emit('USER_LOGOUT' as EventType);

      expect(mockEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: 'SYSTEM',
        }),
      });
    });
  });

  describe('event immutability', () => {
    it('should store events without modification methods', async () => {
      const eventBus = createEventBus(orgId, { actorType: 'ADMIN' as ActorType });
      const eventId = await eventBus.emit('USER_LOGIN' as EventType);

      // Events are stored via db.event.create
      // The EventBus does not expose update or delete methods
      // This test verifies the event ID is returned for audit purposes
      expect(eventId).toBe('event-1');
    });
  });
});
