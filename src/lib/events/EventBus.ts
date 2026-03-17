/**
 * EventBus
 *
 * Immutable audit event system. Every state mutation emits an event.
 * Events are stored in the database and cannot be modified after creation.
 *
 * RLS Support:
 * EventBus can accept an optional Prisma transaction client to emit events
 * within an RLS-scoped context. When called from services using withOrgContext(),
 * pass the transaction client to ensure event writes respect the RLS tenant boundary.
 *
 * For transactional consistency, events should be emitted inside the same
 * withOrgContext() block as the mutation they're recording. This ensures
 * events are only persisted when the mutation succeeds.
 */

import type { ActorType, EventType, Prisma as PrismaTypes } from '@prisma/client';

import { db, withOrgContext } from '../db';

/**
 * Database client type - either the global singleton or a transaction client
 */
type DbClient = typeof db | PrismaTypes.TransactionClient;

export interface EventPayload {
  eventType: EventType;
  actorType: ActorType;
  actorId?: string;
  actorEmail?: string;
  organizationId: string;
  roomId?: string;
  folderId?: string;
  documentId?: string;
  requestId?: string;
  sessionId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface EventContext {
  requestId: string;
  organizationId: string;
  actorId?: string;
  actorEmail?: string;
  actorType: ActorType;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

/**
 * The EventBus class handles event emission and storage.
 * Events are immutable once created.
 */
export class EventBus {
  private context: EventContext;

  constructor(context: EventContext) {
    this.context = context;
  }

  /**
   * Emit an event to the audit log
   *
   * @param eventType - The type of event
   * @param options - Event options (roomId, documentId, etc.)
   * @param client - Optional Prisma transaction client for RLS context
   */
  async emit(
    eventType: EventType,
    options: {
      roomId?: string;
      folderId?: string;
      documentId?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    } = {},
    client?: DbClient
  ): Promise<string> {
    const eventData = {
      eventType,
      actorType: this.context.actorType,
      actorId: this.context.actorId,
      actorEmail: this.context.actorEmail,
      organizationId: this.context.organizationId,
      roomId: options.roomId,
      folderId: options.folderId,
      documentId: options.documentId,
      requestId: this.context.requestId,
      sessionId: this.context.sessionId,
      description: options.description,
      metadata: (options.metadata ?? {}) as PrismaTypes.InputJsonValue,
      ipAddress: this.context.ipAddress,
      userAgent: this.context.userAgent,
    };

    // If a client is provided, use it directly (already in RLS context)
    if (client) {
      const event = await client.event.create({ data: eventData });
      return event.id;
    }

    // Otherwise, wrap in RLS context
    return withOrgContext(this.context.organizationId, async (tx) => {
      const event = await tx.event.create({ data: eventData });
      return event.id;
    });
  }

  /**
   * Emit multiple events in a transaction
   *
   * @param events - Array of events to emit
   * @param client - Optional Prisma transaction client for RLS context
   */
  async emitBatch(
    events: Array<{
      eventType: EventType;
      roomId?: string;
      folderId?: string;
      documentId?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }>,
    client?: DbClient
  ): Promise<string[]> {
    // If a client is provided, use it directly (already in RLS context)
    if (client) {
      const result = await Promise.all(
        events.map((e) =>
          client.event.create({
            data: {
              eventType: e.eventType,
              actorType: this.context.actorType,
              actorId: this.context.actorId,
              actorEmail: this.context.actorEmail,
              organizationId: this.context.organizationId,
              roomId: e.roomId,
              folderId: e.folderId,
              documentId: e.documentId,
              requestId: this.context.requestId,
              sessionId: this.context.sessionId,
              description: e.description,
              metadata: (e.metadata ?? {}) as PrismaTypes.InputJsonValue,
              ipAddress: this.context.ipAddress,
              userAgent: this.context.userAgent,
            },
          })
        )
      );
      return result.map((e) => e.id);
    }

    // Otherwise, wrap in RLS context
    return withOrgContext(this.context.organizationId, async (tx) => {
      const result = await Promise.all(
        events.map((e) =>
          tx.event.create({
            data: {
              eventType: e.eventType,
              actorType: this.context.actorType,
              actorId: this.context.actorId,
              actorEmail: this.context.actorEmail,
              organizationId: this.context.organizationId,
              roomId: e.roomId,
              folderId: e.folderId,
              documentId: e.documentId,
              requestId: this.context.requestId,
              sessionId: this.context.sessionId,
              description: e.description,
              metadata: (e.metadata ?? {}) as PrismaTypes.InputJsonValue,
              ipAddress: this.context.ipAddress,
              userAgent: this.context.userAgent,
            },
          })
        )
      );
      return result.map((e) => e.id);
    });
  }
}

/**
 * Create an EventBus instance from session context
 */
export function createEventBus(
  organizationId: string,
  options: {
    requestId?: string;
    actorId?: string;
    actorEmail?: string;
    actorType?: ActorType;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  } = {}
): EventBus {
  return new EventBus({
    requestId: options.requestId ?? generateRequestId(),
    organizationId,
    actorId: options.actorId,
    actorEmail: options.actorEmail,
    actorType: options.actorType ?? 'SYSTEM',
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    sessionId: options.sessionId,
  });
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Query helpers for events

/**
 * Get events for an organization
 * Uses RLS context for tenant isolation
 */
export async function getOrganizationEvents(
  organizationId: string,
  options: {
    eventTypes?: EventType[];
    roomId?: string;
    documentId?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  } = {},
  client?: DbClient
) {
  const where = {
    organizationId,
    ...(options.eventTypes?.length && { eventType: { in: options.eventTypes } }),
    ...(options.roomId && { roomId: options.roomId }),
    ...(options.documentId && { documentId: options.documentId }),
    ...(options.actorId && { actorId: options.actorId }),
    ...(options.from && { createdAt: { gte: options.from } }),
    ...(options.to && { createdAt: { lte: options.to } }),
  };

  // If a client is provided, use it directly
  if (client) {
    return client.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
      skip: options.offset ?? 0,
    });
  }

  // Otherwise, wrap in RLS context
  return withOrgContext(organizationId, async (tx) => {
    return tx.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
      skip: options.offset ?? 0,
    });
  });
}

/**
 * Get event count by type for analytics
 * Uses RLS context for tenant isolation
 */
export async function getEventCounts(
  organizationId: string,
  options: {
    roomId?: string;
    from?: Date;
    to?: Date;
  } = {},
  client?: DbClient
) {
  const where = {
    organizationId,
    ...(options.roomId && { roomId: options.roomId }),
    ...(options.from && { createdAt: { gte: options.from } }),
    ...(options.to && { createdAt: { lte: options.to } }),
  };

  // If a client is provided, use it directly
  if (client) {
    return client.event.groupBy({
      by: ['eventType'],
      where,
      _count: true,
    });
  }

  // Otherwise, wrap in RLS context
  return withOrgContext(organizationId, async (tx) => {
    return tx.event.groupBy({
      by: ['eventType'],
      where,
      _count: true,
    });
  });
}
