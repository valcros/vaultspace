/**
 * EventBus
 *
 * Immutable audit event system. Every state mutation emits an event.
 * Events are stored in the database and cannot be modified after creation.
 */

import type { ActorType, EventType, Prisma } from '@prisma/client';

import { db } from '../db';

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
   */
  async emit(
    eventType: EventType,
    options: {
      roomId?: string;
      folderId?: string;
      documentId?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    const event = await db.event.create({
      data: {
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
        metadata: (options.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: this.context.ipAddress,
        userAgent: this.context.userAgent,
      },
    });

    return event.id;
  }

  /**
   * Emit multiple events in a transaction
   */
  async emitBatch(
    events: Array<{
      eventType: EventType;
      roomId?: string;
      folderId?: string;
      documentId?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<string[]> {
    const result = await db.$transaction(
      events.map((e) =>
        db.event.create({
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
            metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
            ipAddress: this.context.ipAddress,
            userAgent: this.context.userAgent,
          },
        })
      )
    );

    return result.map((e) => e.id);
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
  } = {}
) {
  return db.event.findMany({
    where: {
      organizationId,
      ...(options.eventTypes?.length && { eventType: { in: options.eventTypes } }),
      ...(options.roomId && { roomId: options.roomId }),
      ...(options.documentId && { documentId: options.documentId }),
      ...(options.actorId && { actorId: options.actorId }),
      ...(options.from && { createdAt: { gte: options.from } }),
      ...(options.to && { createdAt: { lte: options.to } }),
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 100,
    skip: options.offset ?? 0,
  });
}

/**
 * Get event count by type for analytics
 */
export async function getEventCounts(
  organizationId: string,
  options: {
    roomId?: string;
    from?: Date;
    to?: Date;
  } = {}
) {
  return db.event.groupBy({
    by: ['eventType'],
    where: {
      organizationId,
      ...(options.roomId && { roomId: options.roomId }),
      ...(options.from && { createdAt: { gte: options.from } }),
      ...(options.to && { createdAt: { lte: options.to } }),
    },
    _count: true,
  });
}
