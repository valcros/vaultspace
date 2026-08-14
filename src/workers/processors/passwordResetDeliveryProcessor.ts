import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { UnrecoverableError, type Job } from 'bullmq';

import { createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { resolvePasswordResetAuditScope } from '@/lib/auth/passwordResetAuditScope';
import {
  decryptPasswordResetRecoveryToken,
  PasswordResetRecoveryError,
} from '@/lib/auth/passwordResetRecovery';
import { lockPasswordResetUser } from '@/lib/auth/passwordResetToken';
import { bootstrapDb, setBootstrapContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { normalizeEmailError } from '@/providers/email/errors';
import type {
  PasswordResetAcceptanceJobPayload,
  PasswordResetDeliveryJobPayload,
} from '@/workers/types';
import { JOB_NAMES, PASSWORD_RESET_ACCEPTANCE_JOB_OPTIONS, QUEUE_NAMES } from '@/workers/types';

const SEND_LEASE_MS = 3 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 60 * 1000;
const ACCEPTANCE_WRITE_ATTEMPTS = 3;
const PASSWORD_RESET_ACCEPTANCE_PROVIDERS = new Set(['acs', 'smtp', 'console']);
const TRANSIENT_ACCEPTANCE_WRITE_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2034',
]);

function acceptancePersistenceErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode ?? null;
  }
  return null;
}

function isTransientAcceptancePersistenceError(error: unknown): boolean {
  const code = acceptancePersistenceErrorCode(error);
  return code !== null && TRANSIENT_ACCEPTANCE_WRITE_CODES.has(code);
}

class FlowNotClaimableError extends Error {}
class ProviderTimeoutError extends Error {}
type ProviderCorrelationPersistenceCode =
  | 'PASSWORD_RESET_PROVIDER_CORRELATION_INVALID'
  | 'PASSWORD_RESET_PROVIDER_CORRELATION_CONFLICT'
  | 'PASSWORD_RESET_PROVIDER_CORRELATION_SOURCE_IMMUTABLE';

const PROVIDER_CORRELATION_PERSISTENCE_CODES: readonly ProviderCorrelationPersistenceCode[] = [
  'PASSWORD_RESET_PROVIDER_CORRELATION_INVALID',
  'PASSWORD_RESET_PROVIDER_CORRELATION_CONFLICT',
  'PASSWORD_RESET_PROVIDER_CORRELATION_SOURCE_IMMUTABLE',
];

class ProviderCorrelationPersistenceError extends Error {
  constructor(public readonly code: ProviderCorrelationPersistenceCode) {
    super('Password reset provider correlation persistence conflict');
    this.name = 'ProviderCorrelationPersistenceError';
  }
}

class RetryableProviderCorrelationAuditError extends Error {
  constructor() {
    super('Password reset provider correlation audit persistence is temporarily unavailable');
    this.name = 'RetryableProviderCorrelationAuditError';
  }
}

class RetryableAcceptancePersistenceError extends Error {
  constructor() {
    super('Password reset acceptance persistence is temporarily unavailable');
    this.name = 'RetryableAcceptancePersistenceError';
  }
}

function providerCorrelationPersistenceCode(
  error: unknown
): ProviderCorrelationPersistenceCode | null {
  if (error instanceof ProviderCorrelationPersistenceError) {
    return error.code;
  }
  const message = error instanceof Error ? error.message : '';
  return PROVIDER_CORRELATION_PERSISTENCE_CODES.find((code) => message.includes(code)) ?? null;
}

type ResetAuditOutcome = 'accepted' | 'blocked' | 'cancelled' | 'conflict' | 'failure' | 'unknown';

interface ResetAuditSource {
  userId: string;
  requestId: string | null;
  organizationId: string | null;
  auditOrganizationIds: string[];
}

function log(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>): void {
  const line = JSON.stringify({ component: 'password-reset-delivery', ...fields });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function wipedRecoveryData(now = new Date()) {
  return {
    cipherVersion: null,
    keyId: null,
    nonce: null,
    ciphertext: null,
    authTag: null,
    wipedAt: now,
    sendLeaseId: null,
    sendLeaseExpiresAt: null,
    enqueueLeaseId: null,
    enqueueLeaseExpiresAt: null,
  };
}

async function createFlowAuditEvents(
  tx: Prisma.TransactionClient,
  input: {
    flowId: string;
    reset: ResetAuditSource;
    idempotencySuffix: string;
    description: string;
    outcome: ResetAuditOutcome;
    stage: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const auditScope = await resolvePasswordResetAuditScope(tx, input.reset, {
    allowLegacyCurrentMembershipFallback: true,
  });
  for (const organizationId of auditScope.organizationIds) {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    await createSecurityAuditEvent(tx, {
      organizationId,
      eventType: 'USER_PASSWORD_RESET',
      actorType: 'SYSTEM',
      requestId: input.reset.requestId ?? `recovery-${input.flowId}`,
      correlationId: input.flowId,
      idempotencyKey: `password-reset-${input.flowId}-${input.idempotencySuffix}-${organizationId}`,
      description: input.description,
      metadata: {
        outcome: input.outcome,
        stage: input.stage,
        targetUserId: input.reset.userId,
        auditScopeSource: auditScope.source,
        ...input.metadata,
      },
    });
  }
}

async function recordProviderCorrelationConflict(input: {
  payload: PasswordResetAcceptanceJobPayload;
  errorCode: ProviderCorrelationPersistenceCode | 'PROVIDER_ACCEPTANCE_STATE_CONFLICT';
}): Promise<boolean> {
  return bootstrapDb.$transaction(async (tx) => {
    await setBootstrapContext(tx);
    const reset = await tx.passwordResetToken.findUnique({
      where: { id: input.payload.flowId },
      select: {
        userId: true,
        requestId: true,
        organizationId: true,
        auditOrganizationIds: true,
      },
    });
    if (!reset) {
      return false;
    }
    await createFlowAuditEvents(tx, {
      flowId: input.payload.flowId,
      reset,
      idempotencySuffix: `provider-correlation-conflict-${input.errorCode.toLowerCase()}-${input.payload.sendFence}`,
      description: 'Password reset provider acceptance conflicted with protected correlation state',
      outcome: 'conflict',
      stage: 'provider_acceptance_reconciliation',
      metadata: {
        provider: input.payload.provider,
        sendFence: input.payload.sendFence,
        errorCode: input.errorCode,
      },
    });
    return true;
  });
}

async function transitionClaimedFlow(input: {
  flowId: string;
  leaseId: string;
  sendFence: number;
  deliveryAttempt: number;
  deliveryStatus: string;
  enqueueStatus: string;
  errorCode: string;
  preserveEnvelope: boolean;
  nextEnqueueAt?: Date;
  audit: {
    suffix: string;
    description: string;
    outcome: Exclude<ResetAuditOutcome, 'accepted' | 'cancelled' | 'conflict'>;
    stage: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<boolean> {
  return bootstrapDb.$transaction(async (tx) => {
    await setBootstrapContext(tx);
    await tx.$queryRaw`
      SELECT 1 FROM password_reset_tokens
      WHERE id = ${input.flowId}
      FOR UPDATE`;
    await tx.$queryRaw`
      SELECT 1 FROM password_reset_recoveries
      WHERE "flowId" = ${input.flowId}
      FOR UPDATE`;
    const reset = await tx.passwordResetToken.findUnique({
      where: { id: input.flowId },
      select: {
        userId: true,
        requestId: true,
        organizationId: true,
        auditOrganizationIds: true,
        deliveryStatus: true,
        deliveryAttempts: true,
        providerAcceptedAt: true,
      },
    });
    const recovery = await tx.passwordResetRecovery.findUnique({
      where: { flowId: input.flowId },
      select: { wipedAt: true, sendLeaseId: true, sendFence: true },
    });
    if (
      !reset ||
      !recovery ||
      reset.providerAcceptedAt ||
      reset.deliveryStatus !== 'SENDING' ||
      reset.deliveryAttempts !== input.deliveryAttempt ||
      recovery.wipedAt ||
      recovery.sendLeaseId !== input.leaseId ||
      recovery.sendFence !== input.sendFence
    ) {
      return false;
    }

    await tx.passwordResetToken.update({
      where: { id: input.flowId },
      data: {
        deliveryStatus: input.deliveryStatus,
        deliveryErrorCode: input.errorCode,
        lastDeliveryAttemptAt: new Date(),
      },
    });
    await tx.passwordResetRecovery.update({
      where: { flowId: input.flowId },
      data: input.preserveEnvelope
        ? {
            enqueueStatus: input.enqueueStatus,
            deliveryAttempt: { increment: 1 },
            sendLeaseId: null,
            sendLeaseExpiresAt: null,
            nextEnqueueAt: input.nextEnqueueAt ?? new Date(Date.now() + 5 * 60_000),
          }
        : { ...wipedRecoveryData(), enqueueStatus: input.enqueueStatus },
    });
    await createFlowAuditEvents(tx, {
      flowId: input.flowId,
      reset,
      idempotencySuffix: input.audit.suffix,
      description: input.audit.description,
      outcome: input.audit.outcome,
      stage: input.audit.stage,
      metadata: {
        deliveryAttempt: input.deliveryAttempt,
        deliveryStatus: input.deliveryStatus,
        errorCode: input.errorCode,
        sendFence: input.sendFence,
        ...input.audit.metadata,
      },
    });
    return true;
  });
}

async function withProviderTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ProviderTimeoutError('provider timeout')),
          PROVIDER_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function persistProviderAcceptance(
  payload: PasswordResetAcceptanceJobPayload
): Promise<'recorded' | 'already-recorded' | 'conflict'> {
  return bootstrapDb.$transaction(async (tx) => {
    await setBootstrapContext(tx);
    // Serialize direct and queued acceptance persistence so the first provider
    // message ID wins even when both recovery paths run concurrently.
    await tx.$queryRaw`
      SELECT 1 FROM password_reset_tokens
      WHERE id = ${payload.flowId}
      FOR UPDATE`;
    await tx.$queryRaw`
      SELECT 1 FROM password_reset_recoveries
      WHERE "flowId" = ${payload.flowId}
      FOR UPDATE`;
    const existing = await tx.passwordResetToken.findUnique({
      where: { id: payload.flowId },
      select: {
        userId: true,
        requestId: true,
        organizationId: true,
        auditOrganizationIds: true,
        provider: true,
        providerMessageId: true,
        providerOperationId: true,
        providerAcceptedAt: true,
        providerCorrelationSchemaVersion: true,
        deliveryStatus: true,
      },
    });
    const recovery = await tx.passwordResetRecovery.findUnique({
      where: { flowId: payload.flowId },
      select: {
        sendFence: true,
        providerOperationId: true,
        enqueueStatus: true,
        wipedAt: true,
      },
    });
    if (!existing || !recovery) {
      return 'conflict';
    }
    const providerOperationId = recovery.providerOperationId;
    const alreadyRecorded =
      existing.providerMessageId === payload.providerMessageId &&
      existing.providerOperationId === providerOperationId &&
      providerOperationId === payload.flowId &&
      existing.provider === payload.provider &&
      existing.providerCorrelationSchemaVersion === 1 &&
      existing.deliveryStatus === 'PROVIDER_ACCEPTED' &&
      existing.providerAcceptedAt !== null &&
      recovery.sendFence === payload.sendFence;
    if (alreadyRecorded) {
      return 'already-recorded';
    }
    const conflict =
      Boolean(existing.providerMessageId) ||
      existing.providerCorrelationSchemaVersion !== 1 ||
      existing.provider !== payload.provider ||
      providerOperationId !== payload.flowId ||
      recovery.sendFence !== payload.sendFence ||
      (existing.providerOperationId !== null &&
        existing.providerOperationId !== providerOperationId);
    if (conflict) {
      return 'conflict';
    }

    await tx.passwordResetToken.update({
      where: { id: payload.flowId },
      data: {
        deliveryStatus: 'PROVIDER_ACCEPTED',
        provider: payload.provider,
        providerOperationId,
        providerMessageId: payload.providerMessageId,
        providerAcceptedAt: new Date(payload.providerAcceptedAt),
        deliveryErrorCode: null,
        lastDeliveryAttemptAt: new Date(),
      },
    });
    // Once acceptance is authoritative, the bearer envelope must be wiped even
    // if another lifecycle edge already cleared or advanced the send lease.
    await tx.passwordResetRecovery.update({
      where: { flowId: payload.flowId },
      data: {
        ...wipedRecoveryData(),
        enqueueStatus:
          recovery.wipedAt &&
          [
            'REDEEMED',
            'SUPERSEDED',
            'EMAIL_CHANGED',
            'MEMBERSHIP_DEACTIVATED',
            'ACCOUNT_DEACTIVATED',
            'CANCELLED',
          ].includes(recovery.enqueueStatus)
            ? recovery.enqueueStatus
            : 'PROVIDER_ACCEPTED',
      },
    });
    await createFlowAuditEvents(tx, {
      flowId: payload.flowId,
      reset: {
        ...existing,
        requestId: existing.requestId ?? payload.requestId,
      },
      idempotencySuffix: 'accepted',
      description: 'Password reset email was accepted by the provider',
      outcome: 'accepted',
      stage: 'provider_submission',
      metadata: {
        provider: payload.provider,
        sendFence: payload.sendFence,
      },
    });
    return 'recorded';
  });
}

async function persistProviderAcceptanceWithRetry(
  payload: PasswordResetAcceptanceJobPayload
): Promise<'recorded' | 'already-recorded' | 'conflict'> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ACCEPTANCE_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await persistProviderAcceptance(payload);
    } catch (error) {
      lastError = error;
      const correlationCode = providerCorrelationPersistenceCode(error);
      if (correlationCode) {
        throw new ProviderCorrelationPersistenceError(correlationCode);
      }
      const retryable = isTransientAcceptancePersistenceError(error);
      if (!retryable) {
        throw error;
      }
      if (attempt < ACCEPTANCE_WRITE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 75));
      }
    }
  }
  if (isTransientAcceptancePersistenceError(lastError)) {
    throw new RetryableAcceptancePersistenceError();
  }
  throw lastError;
}

export async function processPasswordResetAcceptanceJob(
  job: Job<PasswordResetAcceptanceJobPayload>
): Promise<void> {
  if (
    job.data.schemaVersion !== 1 ||
    !job.data.flowId ||
    !PASSWORD_RESET_ACCEPTANCE_PROVIDERS.has(job.data.provider) ||
    !job.data.providerMessageId ||
    !job.data.providerAcceptedAt ||
    !Number.isInteger(job.data.sendFence) ||
    job.data.sendFence < 1
  ) {
    log('error', {
      event: 'provider_acceptance_job_rejected',
      outcome: 'invalid_payload',
      correlationId: job.data.flowId || null,
      reason: PASSWORD_RESET_ACCEPTANCE_PROVIDERS.has(job.data.provider)
        ? 'INVALID_SHAPE'
        : 'UNSUPPORTED_PROVIDER',
      jobId: job.id ?? null,
    });
    throw new UnrecoverableError('Invalid password reset acceptance payload');
  }
  let outcome: 'recorded' | 'already-recorded' | 'conflict';
  try {
    outcome = await persistProviderAcceptanceWithRetry(job.data);
  } catch (error) {
    if (error instanceof RetryableAcceptancePersistenceError) {
      throw error;
    }
    if (error instanceof ProviderCorrelationPersistenceError) {
      let auditRecorded: boolean;
      try {
        auditRecorded = await recordProviderCorrelationConflict({
          payload: job.data,
          errorCode: error.code,
        });
      } catch {
        log('error', {
          event: 'provider_acceptance_reconciliation_failed',
          outcome: 'audit_retry_required',
          correlationId: job.data.flowId,
          provider: job.data.provider,
          errorCode: error.code,
          auditRecorded: false,
          jobId: job.id ?? null,
        });
        throw new RetryableProviderCorrelationAuditError();
      }
      log('error', {
        event: 'provider_acceptance_reconciliation_failed',
        outcome: 'terminal_correlation_conflict',
        correlationId: job.data.flowId,
        provider: job.data.provider,
        errorCode: error.code,
        auditRecorded,
        jobId: job.id ?? null,
      });
      throw new UnrecoverableError('Password reset provider correlation persistence conflict');
    }
    log('error', {
      event: 'provider_acceptance_reconciliation_failed',
      outcome: 'terminal_persistence_error',
      correlationId: job.data.flowId,
      provider: job.data.provider,
      errorCode: acceptancePersistenceErrorCode(error) ?? 'ACCEPTANCE_PERSISTENCE_NOT_RETRYABLE',
      jobId: job.id ?? null,
    });
    throw new UnrecoverableError('Password reset acceptance persistence is not retryable');
  }
  if (outcome === 'conflict') {
    let auditRecorded: boolean;
    try {
      auditRecorded = await recordProviderCorrelationConflict({
        payload: job.data,
        errorCode: 'PROVIDER_ACCEPTANCE_STATE_CONFLICT',
      });
    } catch {
      log('error', {
        event: 'provider_acceptance_reconciliation_failed',
        outcome: 'audit_retry_required',
        correlationId: job.data.flowId,
        provider: job.data.provider,
        errorCode: 'PROVIDER_ACCEPTANCE_STATE_CONFLICT',
        auditRecorded: false,
        jobId: job.id ?? null,
      });
      throw new RetryableProviderCorrelationAuditError();
    }
    log('error', {
      event: 'provider_acceptance_reconciliation_failed',
      outcome: 'terminal_state_conflict',
      correlationId: job.data.flowId,
      provider: job.data.provider,
      errorCode: 'PROVIDER_ACCEPTANCE_STATE_CONFLICT',
      auditRecorded,
      jobId: job.id ?? null,
    });
  }
  log(outcome === 'conflict' ? 'error' : 'info', {
    event: 'provider_acceptance_reconciled',
    outcome,
    correlationId: job.data.flowId,
    provider: job.data.provider,
    sendFence: job.data.sendFence,
    jobId: job.id ?? null,
  });
}

export async function processPasswordResetDeliveryJob(
  job: Job<PasswordResetDeliveryJobPayload>
): Promise<void> {
  const { flowId, deliveryAttempt } = job.data;
  if (job.data.schemaVersion !== 1 || deliveryAttempt < 1) {
    log('error', {
      event: 'delivery_job_rejected',
      outcome: 'invalid_payload',
      correlationId: flowId,
      jobId: job.id ?? null,
    });
    return;
  }

  const candidate = await bootstrapDb.passwordResetToken.findUnique({
    where: { id: flowId },
    select: { userId: true },
  });
  if (!candidate) {
    return;
  }

  const emailProvider = getProviders().email;
  const provider = emailProvider.providerName;

  const leaseId = randomUUID();
  const claimed = await bootstrapDb
    .$transaction(async (tx) => {
      await setBootstrapContext(tx);
      await lockPasswordResetUser(tx, candidate.userId);

      const now = new Date();
      const reset = await tx.passwordResetToken.findUnique({
        where: { id: flowId },
        include: { recovery: true },
      });
      const user = await tx.user.findUnique({
        where: { id: candidate.userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          isActive: true,
          organizations: {
            where: { isActive: true, organization: { isActive: true } },
            include: {
              organization: {
                select: {
                  id: true,
                  name: true,
                  emailSenderName: true,
                  emailSenderAddress: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      const newest = await tx.passwordResetToken.findFirst({
        where: { userId: candidate.userId, usedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      if (
        reset?.recovery?.wipedAt ||
        (reset?.recovery && reset.recovery.deliveryAttempt !== deliveryAttempt)
      ) {
        // A stale or duplicate job is not authorized to mutate the current flow.
        throw new FlowNotClaimableError();
      }

      const deliveryContractErrorCode =
        reset?.providerCorrelationSchemaVersion !== 1
          ? 'DELIVERY_CONTRACT_UNMARKED'
          : reset.recovery?.providerOperationId !== flowId
            ? 'DELIVERY_CONTRACT_OPERATION_MISMATCH'
            : 'FLOW_NOT_CURRENT';

      if (
        !reset?.recovery ||
        reset.providerCorrelationSchemaVersion !== 1 ||
        reset.recovery.providerOperationId !== flowId ||
        !user?.isActive ||
        user.organizations.length === 0 ||
        reset.usedAt ||
        reset.expiresAt <= now ||
        newest?.id !== flowId ||
        !reset.recovery.keyId ||
        !reset.recovery.nonce ||
        !reset.recovery.ciphertext ||
        !reset.recovery.authTag
      ) {
        if (reset?.recovery && !reset.recovery.wipedAt) {
          await tx.passwordResetRecovery.update({
            where: { flowId },
            data: { ...wipedRecoveryData(now), enqueueStatus: 'CANCELLED' },
          });
        }
        if (reset && !reset.usedAt && reset.deliveryStatus !== 'PROVIDER_ACCEPTED') {
          await tx.passwordResetToken.update({
            where: { id: flowId },
            data: {
              deliveryStatus: 'CANCELLED',
              deliveryErrorCode: deliveryContractErrorCode,
            },
          });
        }
        if (reset) {
          await createFlowAuditEvents(tx, {
            flowId,
            reset,
            idempotencySuffix: 'cancelled',
            description:
              'Password reset delivery was cancelled because the flow is no longer current',
            outcome: 'cancelled',
            stage: 'delivery_claim',
            metadata: {
              deliveryAttempt,
              errorCode: deliveryContractErrorCode,
            },
          });
        }
        return { outcome: 'cancelled' as const };
      }

      const senderMembership = reset.organizationId
        ? user.organizations.find((item) => item.organization.id === reset.organizationId)
        : user.organizations.length === 1
          ? user.organizations[0]
          : undefined;
      const retryableTokenStatuses = [
        'PENDING',
        'QUEUED',
        'QUEUE_RETRYING',
        'FAILED_RETRYING',
        'RECOVERY_BLOCKED_CONFIGURATION',
      ];
      const retryableRecoveryStatuses = [
        'PENDING',
        'ENQUEUE_CLAIMED',
        'QUEUED',
        'QUEUE_RETRYING',
        'RECOVERY_BLOCKED_CONFIGURATION',
      ];
      if (
        reset.provider &&
        reset.provider !== provider &&
        retryableTokenStatuses.includes(reset.deliveryStatus) &&
        retryableRecoveryStatuses.includes(reset.recovery.enqueueStatus)
      ) {
        const recoveryTransition = await tx.passwordResetRecovery.updateMany({
          where: {
            flowId,
            deliveryAttempt,
            wipedAt: null,
            enqueueStatus: { in: retryableRecoveryStatuses },
          },
          data: {
            ...wipedRecoveryData(now),
            enqueueStatus: 'PROVIDER_CONFIGURATION_MISMATCH',
          },
        });
        if (recoveryTransition.count !== 1) {
          throw new FlowNotClaimableError();
        }
        const tokenTransition = await tx.passwordResetToken.updateMany({
          where: {
            id: flowId,
            provider: reset.provider,
            usedAt: null,
            expiresAt: { gt: now },
            deliveryStatus: { in: retryableTokenStatuses },
            deliveryAttempts: { lt: deliveryAttempt },
          },
          data: {
            deliveryStatus: 'PROVIDER_CONFIGURATION_MISMATCH',
            deliveryErrorCode: 'PROVIDER_CHANGED_DURING_RETRY',
            lastDeliveryAttemptAt: now,
          },
        });
        if (tokenTransition.count !== 1) {
          throw new FlowNotClaimableError();
        }
        await createFlowAuditEvents(tx, {
          flowId,
          reset,
          idempotencySuffix: `provider-mismatch-${deliveryAttempt}`,
          description: 'Password reset email retry was blocked after the provider changed',
          outcome: 'blocked',
          stage: 'provider_submission',
          metadata: {
            previousProvider: reset.provider,
            configuredProvider: provider,
            deliveryAttempt,
            errorCode: 'PROVIDER_CHANGED_DURING_RETRY',
          },
        });
        return { outcome: 'provider_mismatch' as const, previousProvider: reset.provider };
      }
      const recoveryClaim = await tx.passwordResetRecovery.updateMany({
        where: {
          flowId,
          deliveryAttempt,
          wipedAt: null,
          sendLeaseId: null,
          enqueueStatus: {
            in: retryableRecoveryStatuses,
          },
        },
        data: {
          enqueueStatus: 'SENDING',
          sendLeaseId: leaseId,
          sendLeaseExpiresAt: new Date(now.getTime() + SEND_LEASE_MS),
          sendFence: { increment: 1 },
        },
      });
      if (recoveryClaim.count !== 1) {
        throw new FlowNotClaimableError();
      }

      const resetClaim = await tx.passwordResetToken.updateMany({
        where: {
          id: flowId,
          usedAt: null,
          expiresAt: { gt: now },
          deliveryStatus: {
            in: retryableTokenStatuses,
          },
          deliveryAttempts: { lt: deliveryAttempt },
          OR: [{ provider: null }, { provider }],
        },
        data: {
          deliveryStatus: 'SENDING',
          deliveryAttempts: deliveryAttempt,
          lastDeliveryAttemptAt: now,
          deliveryErrorCode: null,
          provider,
          providerOperationId: reset.recovery.providerOperationId,
        },
      });
      if (resetClaim.count !== 1) {
        throw new FlowNotClaimableError();
      }

      return {
        outcome: 'claimed' as const,
        reset,
        recovery: { ...reset.recovery, sendFence: reset.recovery.sendFence + 1 },
        user,
        senderMembership,
      };
    })
    .catch((error) => {
      if (error instanceof FlowNotClaimableError) {
        return null;
      }
      throw error;
    });

  if (!claimed) {
    log('info', {
      event: 'provider_submission_skipped',
      outcome: 'not_claimable',
      correlationId: flowId,
      deliveryAttempt,
      jobId: job.id ?? null,
    });
    return;
  }
  if (claimed.outcome === 'cancelled') {
    log('warn', {
      event: 'delivery_flow_cancelled',
      outcome: 'cancelled',
      correlationId: flowId,
      deliveryAttempt,
      jobId: job.id ?? null,
    });
    return;
  }
  if (claimed.outcome === 'provider_mismatch') {
    log('error', {
      event: 'provider_submission_skipped',
      outcome: 'blocked',
      reason: 'PROVIDER_CHANGED_DURING_RETRY',
      correlationId: flowId,
      previousProvider: claimed.previousProvider,
      configuredProvider: provider,
      deliveryAttempt,
      jobId: job.id ?? null,
    });
    return;
  }

  let publicToken: string;
  try {
    const cipherVersion = claimed.recovery.cipherVersion as 1 | 2;
    publicToken = decryptPasswordResetRecoveryToken(
      {
        cipherVersion,
        keyId: claimed.recovery.keyId!,
        nonce: Buffer.from(claimed.recovery.nonce!),
        ciphertext: Buffer.from(claimed.recovery.ciphertext!),
        authTag: Buffer.from(claimed.recovery.authTag!),
      },
      claimed.user.email,
      claimed.recovery.recipientFingerprint,
      cipherVersion === 2
        ? {
            flowId,
            storedToken: claimed.reset.token,
            providerOperationId: claimed.recovery.providerOperationId,
          }
        : {
            flowId,
            userId: claimed.reset.userId,
            storedToken: claimed.reset.token,
            expiresAt: claimed.reset.expiresAt,
          }
    );
  } catch (error) {
    const errorCode =
      error instanceof PasswordResetRecoveryError
        ? error.code
        : 'PASSWORD_RESET_RECOVERY_DECRYPT_FAILED';
    const configurationBlocked =
      errorCode === 'PASSWORD_RESET_RECOVERY_KEYS_MISSING' ||
      errorCode === 'PASSWORD_RESET_RECOVERY_KEYS_INVALID' ||
      errorCode === 'PASSWORD_RESET_RECOVERY_KEY_UNAVAILABLE';
    const transitioned = await transitionClaimedFlow({
      flowId,
      leaseId,
      sendFence: claimed.recovery.sendFence,
      deliveryAttempt,
      deliveryStatus: configurationBlocked
        ? 'RECOVERY_BLOCKED_CONFIGURATION'
        : 'RECOVERY_DECRYPT_FAILED',
      enqueueStatus: configurationBlocked
        ? 'RECOVERY_BLOCKED_CONFIGURATION'
        : 'RECOVERY_DECRYPT_FAILED',
      errorCode,
      preserveEnvelope: configurationBlocked,
      audit: {
        suffix: configurationBlocked
          ? `recovery-configuration-blocked-${deliveryAttempt}`
          : 'recovery-decrypt-failed',
        description: configurationBlocked
          ? 'Password reset delivery is blocked by recovery-key configuration'
          : 'Password reset recovery material failed authenticated decryption',
        outcome: configurationBlocked ? 'blocked' : 'failure',
        stage: 'recovery_decrypt',
      },
    });
    log('error', {
      event: 'recovery_decrypt',
      outcome: transitioned
        ? configurationBlocked
          ? 'blocked_configuration'
          : 'failed_terminal'
        : 'superseded_by_authoritative_state',
      correlationId: flowId,
      errorCode,
      deliveryAttempt,
    });
    return;
  }

  const org = claimed.senderMembership?.organization;
  const orgName = org?.name ?? 'VaultSpace';
  const resetUrl = new URL('/auth/reset-password', process.env['APP_URL']);
  resetUrl.hash = new URLSearchParams({ token: publicToken }).toString();
  const operationId = claimed.recovery.providerOperationId;
  let result: { messageId: string };

  try {
    result = await withProviderTimeout(
      emailProvider.sendEmail({
        to: claimed.user.email,
        subject: `Reset your ${orgName} password`,
        html: `<p>Hi ${claimed.user.firstName || 'User'},</p><p>Click <a href="${resetUrl.toString()}">here</a> to reset your password.</p><p>This link expires in 1 hour.</p><p>If you didn't request this, please ignore this email.</p>`,
        text: `Hi ${claimed.user.firstName || 'User'},\n\nReset your password: ${resetUrl.toString()}\n\nThis link expires in 1 hour.`,
        from: org?.emailSenderAddress || undefined,
        fromName: org?.emailSenderName || org?.name || undefined,
        operationId,
        sensitiveContent: true,
      })
    );
  } catch (error) {
    const normalized = normalizeEmailError(error, provider);
    // A timeout or retryable transport failure may have happened after provider
    // acceptance. It is never an automatic resend signal.
    const unknown = error instanceof ProviderTimeoutError || normalized.retryable;
    const deliveryStatus = unknown ? 'ACCEPTANCE_UNKNOWN' : 'FAILED_PERMANENT';
    const transitioned = await transitionClaimedFlow({
      flowId,
      leaseId,
      sendFence: claimed.recovery.sendFence,
      deliveryAttempt,
      deliveryStatus,
      enqueueStatus: deliveryStatus,
      errorCode: normalized.code,
      preserveEnvelope: false,
      audit: {
        suffix: unknown ? 'provider-acceptance-unknown' : 'provider-rejected',
        description: unknown
          ? 'Password reset email provider result is unknown'
          : 'Password reset email was rejected by the provider',
        outcome: unknown ? 'unknown' : 'failure',
        stage: 'provider_submission',
        metadata: {
          provider,
          retryable: normalized.retryable,
        },
      },
    });
    log(unknown ? 'error' : 'warn', {
      event: 'provider_submission_failed',
      outcome: transitioned
        ? unknown
          ? 'acceptance_unknown'
          : 'failed_permanent'
        : 'superseded_by_authoritative_state',
      correlationId: flowId,
      provider,
      deliveryAttempt,
      errorCode: normalized.code,
    });
    return;
  }

  const acceptedAt = new Date();
  const acceptance: PasswordResetAcceptanceJobPayload = {
    schemaVersion: 1,
    flowId,
    provider,
    providerMessageId: result.messageId,
    providerAcceptedAt: acceptedAt.toISOString(),
    sendFence: claimed.recovery.sendFence,
    requestId: claimed.reset.requestId,
  };
  log('info', {
    event: 'provider_submission_accepted',
    outcome: 'accepted',
    correlationId: flowId,
    provider,
    deliveryAttempt,
  });

  const messageHash = createHash('sha256').update(result.messageId).digest('hex').slice(0, 16);
  const providers = getProviders();
  const [reconciliationWrite, databaseWrite] = await Promise.allSettled([
    providers.job.addJob(
      QUEUE_NAMES.NORMAL,
      JOB_NAMES.PASSWORD_RESET_ACCEPTANCE_RECONCILE,
      acceptance,
      {
        ...PASSWORD_RESET_ACCEPTANCE_JOB_OPTIONS,
        jobId: `password-reset-${flowId}-accepted-${messageHash}`,
      }
    ),
    persistProviderAcceptanceWithRetry(acceptance),
  ]);

  const correlationConflictCode =
    databaseWrite.status === 'rejected' &&
    databaseWrite.reason instanceof ProviderCorrelationPersistenceError
      ? databaseWrite.reason.code
      : databaseWrite.status === 'fulfilled' && databaseWrite.value === 'conflict'
        ? ('PROVIDER_ACCEPTANCE_STATE_CONFLICT' as const)
        : null;
  if (correlationConflictCode) {
    let auditRecorded = false;
    try {
      auditRecorded = await recordProviderCorrelationConflict({
        payload: acceptance,
        errorCode: correlationConflictCode,
      });
    } catch {
      auditRecorded = false;
    }
    log('error', {
      event: 'provider_acceptance_conflict',
      outcome: 'terminal_correlation_conflict',
      correlationId: flowId,
      provider,
      sendFence: acceptance.sendFence,
      errorCode: correlationConflictCode,
      auditRecorded,
      reconciliationQueued: reconciliationWrite.status === 'fulfilled',
    });
    if (!auditRecorded && reconciliationWrite.status === 'rejected') {
      log('error', {
        event: 'provider_acceptance_durability',
        outcome: 'critical_conflict_audit_and_reconciliation_failed',
        correlationId: flowId,
        provider,
        requestId: claimed.reset.requestId,
        errorCode: correlationConflictCode,
      });
    }
  } else if (databaseWrite.status === 'rejected' && reconciliationWrite.status === 'rejected') {
    log('error', {
      event: 'provider_acceptance_durability',
      outcome: 'critical_both_writes_failed',
      correlationId: flowId,
      provider,
      requestId: claimed.reset.requestId,
    });
  } else if (databaseWrite.status === 'rejected') {
    log('warn', {
      event: 'provider_acceptance_durability',
      outcome: 'database_write_failed_reconciliation_queued',
      correlationId: flowId,
      provider,
      requestId: claimed.reset.requestId,
    });
  } else if (reconciliationWrite.status === 'rejected') {
    log('warn', {
      event: 'provider_acceptance_durability',
      outcome: 'reconciliation_queue_failed_database_recorded',
      correlationId: flowId,
      provider,
      requestId: claimed.reset.requestId,
    });
  }
}
