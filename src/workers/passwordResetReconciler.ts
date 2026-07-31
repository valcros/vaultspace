import { randomUUID } from 'crypto';

import { createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { lockPasswordResetUser } from '@/lib/auth/passwordResetToken';
import { bootstrapDb, setBootstrapContext } from '@/lib/db';
import { createJobProvider } from '@/providers';

import {
  JOB_NAMES,
  PASSWORD_RESET_RECOVERY_JOB_OPTIONS,
  QUEUE_NAMES,
  type PasswordResetDeliveryJobPayload,
} from './types';

const BATCH_SIZE = 50;
const ENQUEUE_LEASE_MS = 2 * 60 * 1000;

interface ReconciliationSummary {
  scanned: number;
  enqueued: number;
  queueDeferred: number;
  expiredWiped: number;
  staleSendingUnknown: number;
  skippedActiveJob: number;
  dryRun: boolean;
}

class PasswordResetPreflightRollback extends Error {}

function wipe(now: Date) {
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

async function terminalizeRecoveryFlow(input: {
  flowId: string;
  deliveryStatus: string;
  enqueueStatus: string;
  errorCode: string;
  auditOutcome: 'failure' | 'unknown' | 'expired';
  expectedTokenStatuses: string[];
  expectedFence?: number;
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
        deliveryStatus: true,
        providerAcceptedAt: true,
      },
    });
    const recovery = await tx.passwordResetRecovery.findUnique({
      where: { flowId: input.flowId },
      select: { wipedAt: true, sendFence: true },
    });
    if (
      !reset ||
      !recovery ||
      recovery.wipedAt ||
      reset.providerAcceptedAt ||
      !input.expectedTokenStatuses.includes(reset.deliveryStatus) ||
      (input.expectedFence !== undefined && recovery.sendFence !== input.expectedFence)
    ) {
      return false;
    }

    await tx.passwordResetToken.update({
      where: { id: input.flowId },
      data: {
        deliveryStatus: input.deliveryStatus,
        deliveryErrorCode: input.errorCode,
      },
    });
    await tx.passwordResetRecovery.update({
      where: { flowId: input.flowId },
      data: { ...wipe(new Date()), enqueueStatus: input.enqueueStatus },
    });

    const user = await tx.user.findUnique({
      where: { id: reset.userId },
      select: {
        organizations: {
          select: { organizationId: true },
        },
      },
    });
    const organizationIds = new Set(
      (user?.organizations ?? []).map((membership) => membership.organizationId)
    );
    if (reset.organizationId) {
      organizationIds.add(reset.organizationId);
    }
    for (const organizationId of organizationIds) {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
      await createSecurityAuditEvent(tx, {
        organizationId,
        eventType: 'USER_PASSWORD_RESET',
        actorType: 'SYSTEM',
        requestId: reset.requestId ?? `recovery-${input.flowId}`,
        correlationId: input.flowId,
        idempotencyKey: `password-reset-${input.flowId}-${input.enqueueStatus.toLowerCase()}-${organizationId}`,
        description: 'Password reset delivery reached a terminal recovery state',
        metadata: {
          outcome: input.auditOutcome,
          stage: 'delivery_reconciliation',
          targetUserId: reset.userId,
          deliveryStatus: input.deliveryStatus,
          errorCode: input.errorCode,
          sendFence: recovery.sendFence,
        },
      });
    }
    return true;
  });
}

async function deferQueueRecovery(input: {
  flowId: string;
  leaseId: string;
  enqueueAttempt: number;
  nextEnqueueAt: Date;
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
        deliveryStatus: true,
        providerAcceptedAt: true,
      },
    });
    const recovery = await tx.passwordResetRecovery.findUnique({
      where: { flowId: input.flowId },
      select: { wipedAt: true, enqueueStatus: true, enqueueLeaseId: true },
    });
    if (
      !reset ||
      !recovery ||
      reset.providerAcceptedAt ||
      recovery.wipedAt ||
      recovery.enqueueStatus !== 'ENQUEUE_CLAIMED' ||
      recovery.enqueueLeaseId !== input.leaseId ||
      !['PENDING', 'QUEUED', 'QUEUE_RETRYING', 'RECOVERY_BLOCKED_CONFIGURATION'].includes(
        reset.deliveryStatus
      )
    ) {
      return false;
    }
    await tx.passwordResetToken.update({
      where: { id: input.flowId },
      data: { deliveryStatus: 'QUEUE_RETRYING', deliveryErrorCode: 'EMAIL_QUEUE_ERROR' },
    });
    await tx.passwordResetRecovery.update({
      where: { flowId: input.flowId },
      data: {
        enqueueStatus: 'QUEUE_RETRYING',
        enqueueLeaseId: null,
        enqueueLeaseExpiresAt: null,
        nextEnqueueAt: input.nextEnqueueAt,
      },
    });

    const user = await tx.user.findUnique({
      where: { id: reset.userId },
      select: {
        organizations: {
          select: { organizationId: true },
        },
      },
    });
    const organizationIds = new Set(
      (user?.organizations ?? []).map((membership) => membership.organizationId)
    );
    if (reset.organizationId) {
      organizationIds.add(reset.organizationId);
    }
    for (const organizationId of organizationIds) {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
      await createSecurityAuditEvent(tx, {
        organizationId,
        eventType: 'USER_PASSWORD_RESET',
        actorType: 'SYSTEM',
        requestId: reset.requestId ?? `recovery-${input.flowId}`,
        correlationId: input.flowId,
        idempotencyKey: `password-reset-${input.flowId}-queue-recovery-deferred-${input.enqueueAttempt}-${organizationId}`,
        description: 'Password reset email remains pending queue recovery',
        metadata: {
          outcome: 'pending',
          stage: 'delivery_reconciliation',
          targetUserId: reset.userId,
          deliveryStatus: 'QUEUE_RETRYING',
          errorCode: 'EMAIL_QUEUE_ERROR',
          enqueueAttempt: input.enqueueAttempt,
          nextEnqueueAt: input.nextEnqueueAt.toISOString(),
        },
      });
    }
    return true;
  });
}

export async function reconcilePasswordResetDeliveries(options?: {
  dryRun?: boolean;
}): Promise<ReconciliationSummary> {
  const dryRun = options?.dryRun ?? false;
  const now = new Date();
  const summary: ReconciliationSummary = {
    scanned: 0,
    enqueued: 0,
    queueDeferred: 0,
    expiredWiped: 0,
    staleSendingUnknown: 0,
    skippedActiveJob: 0,
    dryRun,
  };

  const [expired, staleSending] = await Promise.all([
    bootstrapDb.passwordResetRecovery.findMany({
      where: { wipedAt: null, resetToken: { expiresAt: { lte: now } } },
      select: { flowId: true },
      take: BATCH_SIZE,
    }),
    bootstrapDb.passwordResetRecovery.findMany({
      where: {
        wipedAt: null,
        enqueueStatus: 'SENDING',
        sendLeaseExpiresAt: { lte: now },
        resetToken: { providerAcceptedAt: null },
      },
      select: { flowId: true, sendFence: true },
      take: BATCH_SIZE,
    }),
  ]);

  if (!dryRun) {
    for (const item of expired) {
      if (
        await terminalizeRecoveryFlow({
          flowId: item.flowId,
          deliveryStatus: 'EXPIRED',
          enqueueStatus: 'EXPIRED',
          errorCode: 'TOKEN_EXPIRED',
          auditOutcome: 'expired',
          expectedTokenStatuses: [
            'PENDING',
            'QUEUED',
            'QUEUE_RETRYING',
            'SENDING',
            'RECOVERY_BLOCKED_CONFIGURATION',
          ],
        })
      ) {
        summary.expiredWiped += 1;
      }
    }
    for (const item of staleSending) {
      // Lease expiry proves only that VaultSpace lost certainty. It never proves
      // the provider did not accept the original submission.
      if (
        await terminalizeRecoveryFlow({
          flowId: item.flowId,
          deliveryStatus: 'ACCEPTANCE_UNKNOWN',
          enqueueStatus: 'ACCEPTANCE_UNKNOWN',
          errorCode: 'STALE_SEND_LEASE',
          auditOutcome: 'unknown',
          expectedTokenStatuses: ['SENDING'],
          expectedFence: item.sendFence,
        })
      ) {
        summary.staleSendingUnknown += 1;
      }
    }
  } else {
    summary.expiredWiped = expired.length;
    summary.staleSendingUnknown = staleSending.length;
  }

  const candidates = await bootstrapDb.passwordResetRecovery.findMany({
    where: {
      wipedAt: null,
      nextEnqueueAt: { lte: now },
      OR: [
        {
          enqueueStatus: {
            in: ['PENDING', 'QUEUE_RETRYING', 'RECOVERY_BLOCKED_CONFIGURATION'],
          },
        },
        { enqueueStatus: 'ENQUEUE_CLAIMED', enqueueLeaseExpiresAt: { lte: now } },
        { enqueueStatus: 'QUEUED' },
      ],
      resetToken: {
        usedAt: null,
        expiresAt: { gt: now },
        providerAcceptedAt: null,
        deliveryStatus: {
          in: ['PENDING', 'QUEUED', 'QUEUE_RETRYING', 'RECOVERY_BLOCKED_CONFIGURATION'],
        },
      },
    },
    include: {
      resetToken: { select: { userId: true, queueJobId: true, deliveryStatus: true } },
    },
    orderBy: { nextEnqueueAt: 'asc' },
    take: BATCH_SIZE,
  });
  summary.scanned = candidates.length;
  if (dryRun) {
    return summary;
  }

  const jobProvider = createJobProvider();
  try {
    // Always establish Redis connectivity, including when the recovery backlog
    // is empty. Deployment uses a zero-backlog run as a cutover preflight.
    await jobProvider.waitUntilReady(QUEUE_NAMES.NORMAL);
    for (const candidate of candidates) {
      if (candidate.enqueueStatus === 'QUEUED' && candidate.resetToken.queueJobId) {
        const jobState = await jobProvider.getJobStatus(
          QUEUE_NAMES.NORMAL,
          candidate.resetToken.queueJobId
        );
        if (['waiting', 'delayed', 'active', 'prioritized'].includes(jobState)) {
          summary.skippedActiveJob += 1;
          continue;
        }
        if (jobState === 'completed') {
          // A completed job with no durable acceptance is ambiguous, never a
          // reason to submit again.
          await terminalizeRecoveryFlow({
            flowId: candidate.flowId,
            deliveryStatus: 'ACCEPTANCE_UNKNOWN',
            enqueueStatus: 'ACCEPTANCE_UNKNOWN',
            errorCode: 'COMPLETED_JOB_WITHOUT_ACCEPTANCE',
            auditOutcome: 'unknown',
            expectedTokenStatuses: ['QUEUED'],
          });
          continue;
        }
      }

      const leaseId = randomUUID();
      const claimed = await bootstrapDb.$transaction(async (tx) => {
        await setBootstrapContext(tx);
        await lockPasswordResetUser(tx, candidate.resetToken.userId);
        const lease = await tx.passwordResetRecovery.updateMany({
          where: {
            flowId: candidate.flowId,
            wipedAt: null,
            deliveryAttempt: candidate.deliveryAttempt,
            OR: [
              {
                enqueueStatus: {
                  in: ['PENDING', 'QUEUE_RETRYING', 'QUEUED', 'RECOVERY_BLOCKED_CONFIGURATION'],
                },
              },
              { enqueueStatus: 'ENQUEUE_CLAIMED', enqueueLeaseExpiresAt: { lte: new Date() } },
            ],
          },
          data: {
            enqueueStatus: 'ENQUEUE_CLAIMED',
            enqueueLeaseId: leaseId,
            enqueueLeaseExpiresAt: new Date(Date.now() + ENQUEUE_LEASE_MS),
            enqueueAttempts: { increment: 1 },
          },
        });
        return lease.count === 1;
      });
      if (!claimed) {
        continue;
      }

      const payload: PasswordResetDeliveryJobPayload = {
        schemaVersion: 1,
        flowId: candidate.flowId,
        deliveryAttempt: candidate.deliveryAttempt,
      };
      try {
        const jobId = await jobProvider.addJob(
          QUEUE_NAMES.NORMAL,
          JOB_NAMES.PASSWORD_RESET_DELIVER,
          payload,
          {
            ...PASSWORD_RESET_RECOVERY_JOB_OPTIONS,
            jobId: `password-reset-${candidate.flowId}-delivery-${candidate.deliveryAttempt}`,
          }
        );
        const transition = await bootstrapDb.passwordResetRecovery.updateMany({
          where: {
            flowId: candidate.flowId,
            enqueueStatus: 'ENQUEUE_CLAIMED',
            enqueueLeaseId: leaseId,
          },
          data: {
            enqueueStatus: 'QUEUED',
            enqueueLeaseId: null,
            enqueueLeaseExpiresAt: null,
          },
        });
        if (transition.count === 1) {
          // A fast worker may already have advanced the token. Do not regress it.
          await bootstrapDb.passwordResetToken.updateMany({
            where: {
              id: candidate.flowId,
              deliveryStatus: {
                in: ['PENDING', 'QUEUE_RETRYING', 'QUEUED', 'RECOVERY_BLOCKED_CONFIGURATION'],
              },
            },
            data: { deliveryStatus: 'QUEUED', queueJobId: jobId },
          });
        }
        summary.enqueued += 1;
      } catch (error) {
        const attempts = candidate.enqueueAttempts + 1;
        const delayMs = Math.min(15 * 60_000, 15_000 * 2 ** Math.min(attempts, 6));
        const nextEnqueueAt = new Date(Date.now() + delayMs + Math.floor(Math.random() * 5_000));
        if (
          await deferQueueRecovery({
            flowId: candidate.flowId,
            leaseId,
            enqueueAttempt: attempts,
            nextEnqueueAt,
          })
        ) {
          summary.queueDeferred += 1;
        }
        console.error(
          JSON.stringify({
            component: 'password-reset-reconciler',
            event: 'delivery_enqueue',
            outcome: 'retry_deferred',
            correlationId: candidate.flowId,
            enqueueAttempt: attempts,
            errorCode: 'EMAIL_QUEUE_ERROR',
            errorName: error instanceof Error ? error.name : 'UnknownError',
            nextEnqueueAt: nextEnqueueAt.toISOString(),
          })
        );
      }
    }
  } finally {
    await jobProvider.close?.();
  }
  return summary;
}

export async function preflightPasswordResetRecovery(): Promise<void> {
  if (!process.env['REDIS_URL']) {
    throw new Error('REDIS_URL is required for the password reset preflight');
  }
  const jobProvider = createJobProvider();
  try {
    await jobProvider.waitUntilReady(QUEUE_NAMES.NORMAL);
    let completed = false;
    try {
      await bootstrapDb.$transaction(async (tx) => {
        await setBootstrapContext(tx);
        const membership = await tx.userOrganization.findFirst({
          where: {
            isActive: true,
            user: { isActive: true },
            organization: { isActive: true },
          },
          select: { userId: true, organizationId: true },
        });
        if (!membership) {
          throw new Error('Password reset preflight requires an active organization membership');
        }

        await lockPasswordResetUser(tx, membership.userId);
        const [role] = await tx.$queryRaw<
          Array<{ current_user: string; bypasses_rls: boolean; is_superuser: boolean }>
        >`
          SELECT current_user,
                 rolbypassrls AS bypasses_rls,
                 rolsuper AS is_superuser
          FROM pg_roles
          WHERE rolname = current_user`;
        if (!role || role.bypasses_rls || role.is_superuser) {
          throw new Error('Password reset preflight requires a non-superuser NOBYPASSRLS role');
        }

        const flowId = `preflight-${randomUUID()}`;
        const idempotencyKey = `password-reset-${flowId}-preflight-${membership.organizationId}`;
        await tx.passwordResetToken.create({
          data: {
            id: flowId,
            userId: membership.userId,
            token: `preflight-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60_000),
            requestId: flowId,
            organizationId: membership.organizationId,
            deliveryStatus: 'PENDING',
          },
        });
        await tx.passwordResetRecovery.create({
          data: {
            flowId,
            userId: membership.userId,
            recipientFingerprint: '0'.repeat(64),
            cipherVersion: 1,
            keyId: 'preflight',
            nonce: Buffer.alloc(12),
            ciphertext: Buffer.alloc(48),
            authTag: Buffer.alloc(16),
            providerOperationId: flowId,
          },
        });
        const recovery = await tx.passwordResetRecovery.update({
          where: { flowId },
          data: { enqueueStatus: 'PREFLIGHT_VERIFIED' },
          select: { enqueueStatus: true },
        });
        if (recovery.enqueueStatus !== 'PREFLIGHT_VERIFIED') {
          throw new Error('Password reset preflight recovery update was not visible');
        }

        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${membership.organizationId}, true)`;
        const eventId = await createSecurityAuditEvent(tx, {
          organizationId: membership.organizationId,
          eventType: 'USER_PASSWORD_RESET',
          actorType: 'SYSTEM',
          requestId: flowId,
          correlationId: flowId,
          idempotencyKey,
          description: 'Runtime-role password reset recovery preflight',
          metadata: { outcome: 'preflight', stage: 'runtime_role_verification' },
        });
        const event = await tx.event.findUnique({
          where: { id: eventId },
          select: { id: true },
        });
        if (!event) {
          throw new Error('Password reset preflight audit insertion was not visible');
        }

        completed = true;
        throw new PasswordResetPreflightRollback('Rollback password reset preflight canary');
      });
    } catch (error) {
      if (!(error instanceof PasswordResetPreflightRollback)) {
        throw error;
      }
    }
    if (!completed) {
      throw new Error('Password reset preflight did not complete its runtime probes');
    }
  } finally {
    await jobProvider.close?.();
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const preflight = process.argv.includes('--preflight');
  if (process.env['DATABASE_URL_ADMIN']) {
    throw new Error('DATABASE_URL_ADMIN is forbidden for the password reset reconciler');
  }
  if (!dryRun && !process.env['REDIS_URL']) {
    throw new Error('REDIS_URL is required for the password reset reconciler');
  }
  if (preflight) {
    await preflightPasswordResetRecovery();
    console.log(
      JSON.stringify({
        component: 'password-reset-reconciler',
        event: 'preflight_completed',
        outcome: 'success',
      })
    );
    return;
  }
  if (!dryRun && process.env['PASSWORD_RESET_RECONCILER_ENABLED'] !== 'true') {
    console.log(
      JSON.stringify({
        component: 'password-reset-reconciler',
        event: 'reconciliation_skipped',
        outcome: 'disabled',
      })
    );
    return;
  }
  const summary = await reconcilePasswordResetDeliveries({ dryRun });
  console.log(
    JSON.stringify({
      component: 'password-reset-reconciler',
      event: 'reconciliation_completed',
      outcome: 'success',
      ...summary,
    })
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error) => {
      console.error(
        JSON.stringify({
          component: 'password-reset-reconciler',
          event: 'reconciliation_failed',
          outcome: 'failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
      );
      process.exitCode = 1;
    })
    .finally(() => bootstrapDb.$disconnect());
}
