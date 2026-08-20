import { randomUUID } from 'crypto';
import type { ActorType, EventType, Prisma } from '@prisma/client';

import { withOrgContext } from '@/lib/db';

type AuditClient = Prisma.TransactionClient;

export interface SecurityAuditInput {
  organizationId: string;
  eventType:
    | 'USER_LOGIN'
    | 'USER_LOGOUT'
    | 'USER_PASSWORD_RESET'
    | 'SYSOP_ACCESSED'
    | 'PLATFORM_OPERATOR_GRANTED'
    | 'PLATFORM_OPERATOR_REVOKED'
    | 'SYSOP_IP_ALLOWLIST_UPDATED'
    | 'SYSOP_IP_BLOCKED'
    | 'ORG_DISABLED'
    | 'ORG_ENABLED';
  actorType: ActorType;
  actorId?: string | null;
  actorEmail?: string | null;
  requestId: string;
  correlationId?: string | null;
  sessionId?: string | null;
  idempotencyKey?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type SecurityAuditOutcome = 'captured' | 'failed';

function eventData(input: SecurityAuditInput) {
  return {
    organizationId: input.organizationId,
    eventType: input.eventType as EventType,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail?.toLowerCase().trim() || null,
    requestId: input.requestId,
    correlationId: input.correlationId ?? null,
    sessionId: input.sessionId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    description: input.description,
    metadata: {
      ...input.metadata,
      source: 'native',
      // Org lifecycle events are platform operations, not authentication events.
      category:
        input.eventType === 'ORG_DISABLED' || input.eventType === 'ORG_ENABLED'
          ? 'platform_operations'
          : 'authentication',
      schemaVersion: 1,
      authoritative: true,
    } as Prisma.InputJsonValue,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  };
}

/**
 * Insert an authoritative authentication event inside the caller's transaction.
 * Failures propagate so the security mutation and its audit fact remain atomic.
 */
export async function createSecurityAuditEvent(
  client: AuditClient,
  input: SecurityAuditInput
): Promise<string> {
  const data = eventData(input);
  if (!input.idempotencyKey) {
    const event = await client.event.create({ data });
    return event.id;
  }

  // `events` is structurally append-only: the runtime role has UPDATE and
  // DELETE revoked and a trigger rejects mutations. createMany(skipDuplicates)
  // compiles to INSERT ... ON CONFLICT DO NOTHING, preserving idempotency
  // without requiring UPDATE privilege or aborting the caller's transaction.
  const id = randomUUID();
  const inserted = await client.event.createMany({
    data: { id, ...data },
    skipDuplicates: true,
  });
  if (inserted.count === 1) {
    return id;
  }
  const existing = await client.event.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, organizationId: true },
  });
  if (!existing || existing.organizationId !== input.organizationId) {
    throw new Error('Security audit idempotency conflict is not visible in this organization');
  }
  return existing.id;
}

/**
 * Best-effort capture for lifecycle edges that cannot share the mutation's
 * transaction, such as logout cleanup and terminal email-worker failures.
 */
export async function captureSecurityAudit(
  input: SecurityAuditInput
): Promise<SecurityAuditOutcome> {
  try {
    await withOrgContext(input.organizationId, (tx) => createSecurityAuditEvent(tx, input));
    return 'captured';
  } catch (error) {
    console.error(
      JSON.stringify({
        component: 'security-audit',
        event: 'audit_write',
        outcome: 'failed',
        eventType: input.eventType,
        requestId: input.requestId,
        correlationId: input.correlationId ?? null,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    );
    return 'failed';
  }
}
