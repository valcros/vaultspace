import type { ActorType, EventType, Prisma } from '@prisma/client';

import { withOrgContext } from '@/lib/db';

type AuditClient = Prisma.TransactionClient;

export interface SecurityAuditInput {
  organizationId: string;
  eventType: 'USER_LOGIN' | 'USER_LOGOUT' | 'USER_PASSWORD_RESET';
  actorType: ActorType;
  actorId?: string | null;
  actorEmail?: string | null;
  requestId: string;
  correlationId?: string | null;
  sessionId?: string | null;
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
    description: input.description,
    metadata: {
      ...input.metadata,
      source: 'native',
      category: 'authentication',
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
  const event = await client.event.create({ data: eventData(input) });
  return event.id;
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
