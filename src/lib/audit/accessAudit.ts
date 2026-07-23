import type { ActorType, AuditCaptureMode, EventType, Prisma } from '@prisma/client';

import { withOrgContext } from '@/lib/db';

const AUDIT_MAX_WAIT_MS = 250;
const AUDIT_TRANSACTION_TIMEOUT_MS = 750;
const VIEWER_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;

export const ACCESS_AUDIT_DEDUPE_MS = {
  DOCUMENT_VIEWED: 5 * 60 * 1000,
  DOCUMENT_DOWNLOADED: 3 * 1000,
  LINK_ACCESS_DENIED: 60 * 1000,
} as const;

type AccessEventType =
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'LINK_ACCESSED'
  | 'LINK_ACCESS_DENIED'
  | 'DOCUMENT_VIEWED'
  | 'DOCUMENT_DOWNLOADED';

export interface AccessAuditInput {
  organizationId: string;
  eventType: AccessEventType;
  actorType: ActorType;
  actorId?: string | null;
  actorEmail?: string | null;
  roomId?: string | null;
  documentId?: string | null;
  viewSessionId?: string | null;
  requestId: string;
  description: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  dedupeWindowMs?: number;
  dedupeByIp?: boolean;
  touchViewerActivity?: boolean;
}

export type AccessAuditOutcome = 'disabled' | 'captured' | 'deduplicated' | 'failed';

function defined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function buildDedupeWhere(input: AccessAuditInput, since: Date): Prisma.EventWhereInput {
  const where: Prisma.EventWhereInput = {
    organizationId: input.organizationId,
    eventType: input.eventType as EventType,
    createdAt: { gte: since },
    roomId: input.roomId ?? null,
    documentId: input.documentId ?? null,
  };

  if (input.dedupeByIp && defined(input.ipAddress)) {
    where.ipAddress = input.ipAddress;
  } else if (defined(input.viewSessionId)) {
    where.sessionId = input.viewSessionId;
  } else if (defined(input.actorId)) {
    where.actorId = input.actorId;
  } else if (defined(input.actorEmail)) {
    where.actorEmail = input.actorEmail.toLowerCase().trim();
  } else if (defined(input.ipAddress)) {
    where.ipAddress = input.ipAddress;
  }

  const denialReason = input.metadata?.['reason'];
  if (input.eventType === 'LINK_ACCESS_DENIED' && typeof denialReason === 'string') {
    where.metadata = { path: ['reason'], equals: denialReason };
  }

  return where;
}

/**
 * Capture an access event without ever failing the user-facing operation.
 *
 * The caller awaits this bounded transaction so serverless runtimes cannot
 * discard it after returning a response. All errors are converted to `failed`;
 * login, link access, preview, and download responses retain their established
 * behavior during both SHADOW and AUTHORITATIVE modes.
 */
export async function captureAccessAudit(input: AccessAuditInput): Promise<AccessAuditOutcome> {
  try {
    return await withOrgContext(
      input.organizationId,
      async (tx) => {
        if (input.touchViewerActivity && input.viewSessionId) {
          await tx.viewSession.updateMany({
            where: {
              id: input.viewSessionId,
              organizationId: input.organizationId,
              isActive: true,
              lastActivityAt: {
                lt: new Date(Date.now() - VIEWER_ACTIVITY_REFRESH_MS),
              },
            },
            data: { lastActivityAt: new Date() },
          });
        }

        const organization = await tx.organization.findUnique({
          where: { id: input.organizationId },
          select: { auditCaptureMode: true },
        });

        const mode: AuditCaptureMode = organization?.auditCaptureMode ?? 'OFF';
        if (mode === 'OFF') {
          return 'disabled';
        }

        if (input.dedupeWindowMs && input.dedupeWindowMs > 0) {
          const existing = await tx.event.findFirst({
            where: buildDedupeWhere(input, new Date(Date.now() - input.dedupeWindowMs)),
            select: { id: true },
          });
          if (existing) {
            return 'deduplicated';
          }
        }

        await tx.event.create({
          data: {
            organizationId: input.organizationId,
            eventType: input.eventType as EventType,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            actorEmail: input.actorEmail?.toLowerCase().trim() || null,
            roomId: input.roomId ?? null,
            documentId: input.documentId ?? null,
            sessionId: input.viewSessionId ?? null,
            requestId: input.requestId,
            description: input.description,
            metadata: {
              ...input.metadata,
              source: 'native',
              auditCaptureMode: mode,
              authoritative: mode === 'AUTHORITATIVE',
            } as Prisma.InputJsonValue,
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null,
          },
        });

        return 'captured';
      },
      {
        maxWait: AUDIT_MAX_WAIT_MS,
        timeout: AUDIT_TRANSACTION_TIMEOUT_MS,
      }
    );
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(
      JSON.stringify({
        component: 'access-audit',
        outcome: 'failed',
        eventType: input.eventType,
        requestId: input.requestId,
        errorName,
      })
    );
    return 'failed';
  }
}
