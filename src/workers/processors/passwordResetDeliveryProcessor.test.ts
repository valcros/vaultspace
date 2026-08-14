import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tokenFindUnique: vi.fn(),
  tokenFindFirst: vi.fn(),
  tokenUpdate: vi.fn(),
  tokenUpdateMany: vi.fn(),
  recoveryUpdateMany: vi.fn(),
  recoveryFindUnique: vi.fn(),
  recoveryUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  sendEmail: vi.fn(),
  addJob: vi.fn(),
  eventCreateMany: vi.fn(),
  eventFindUnique: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const client = {
    passwordResetToken: {
      findUnique: mocks.tokenFindUnique,
      findFirst: mocks.tokenFindFirst,
      update: mocks.tokenUpdate,
      updateMany: mocks.tokenUpdateMany,
    },
    passwordResetRecovery: {
      findUnique: mocks.recoveryFindUnique,
      update: mocks.recoveryUpdate,
      updateMany: mocks.recoveryUpdateMany,
    },
    user: { findUnique: mocks.userFindUnique },
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    event: {
      createMany: mocks.eventCreateMany,
      findUnique: mocks.eventFindUnique,
    },
    $transaction: mocks.transaction,
  };
  return {
    bootstrapDb: client,
    setBootstrapContext: (tx: typeof client) => tx.$executeRaw(),
  };
});

vi.mock('@/providers', () => ({
  getConfiguredEmailProviderName: () => 'acs',
  getProviders: () => ({
    email: { providerName: 'acs', sendEmail: mocks.sendEmail },
    job: { addJob: mocks.addJob },
  }),
}));

import { createPasswordResetToken } from '@/lib/auth/passwordResetToken';
import {
  encryptPasswordResetRecoveryToken,
  encryptPasswordResetRecoveryTokenV2,
} from '@/lib/auth/passwordResetRecovery';
import { EmailDeliveryError } from '@/providers/email/errors';
import {
  processPasswordResetAcceptanceJob,
  processPasswordResetDeliveryJob,
} from './passwordResetDeliveryProcessor';

describe('password reset recovery delivery processor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env['APP_URL'] = 'https://app.example.com';
    process.env['SESSION_SECRET'] = 'test-session-secret';
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'test-key';
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({
      'test-key': randomBytes(32).toString('base64'),
    });
    process.env['EMAIL_PROVIDER'] = 'acs';
    mocks.queryRaw.mockResolvedValue([]);
    mocks.executeRaw.mockResolvedValue(1);
    mocks.tokenUpdate.mockResolvedValue({});
    mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
    mocks.recoveryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.recoveryUpdate.mockResolvedValue({});
    mocks.addJob.mockResolvedValue('acceptance-job');
    mocks.eventCreateMany.mockResolvedValue({ count: 1 });
    mocks.eventFindUnique.mockResolvedValue({ id: 'event-1', organizationId: 'org-1' });
    const tx = {
      passwordResetToken: {
        findUnique: mocks.tokenFindUnique,
        findFirst: mocks.tokenFindFirst,
        update: mocks.tokenUpdate,
        updateMany: mocks.tokenUpdateMany,
      },
      passwordResetRecovery: {
        findUnique: mocks.recoveryFindUnique,
        update: mocks.recoveryUpdate,
        updateMany: mocks.recoveryUpdateMany,
      },
      user: { findUnique: mocks.userFindUnique },
      $queryRaw: mocks.queryRaw,
      $executeRaw: mocks.executeRaw,
      event: {
        createMany: mocks.eventCreateMany,
        findUnique: mocks.eventFindUnique,
      },
    };
    mocks.transaction.mockImplementation(async (operation: unknown) =>
      Array.isArray(operation)
        ? Promise.all(operation)
        : (operation as (client: typeof tx) => Promise<unknown>)(tx)
    );
  });

  function arrange(cipherVersion: 1 | 2 = 1) {
    const flowId = 'flow-1';
    const userId = 'user-1';
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const pair = createPasswordResetToken();
    const envelope =
      cipherVersion === 2
        ? encryptPasswordResetRecoveryTokenV2(pair.publicToken, 'user@example.com', {
            flowId,
            storedToken: pair.storedToken,
            providerOperationId: flowId,
          })
        : encryptPasswordResetRecoveryToken(pair.publicToken, 'user@example.com', {
            flowId,
            userId,
            storedToken: pair.storedToken,
            expiresAt,
          });
    const recovery = {
      flowId,
      userId,
      ...envelope,
      wipedAt: null,
      deliveryAttempt: 1,
      sendFence: 0,
      providerOperationId: flowId,
      recipientFingerprint: envelope.recipientFingerprint,
    };
    const reset = {
      id: flowId,
      userId,
      token: pair.storedToken,
      expiresAt,
      usedAt: null,
      requestId: 'request-1',
      organizationId: 'org-1',
      deliveryStatus: 'QUEUED',
      providerCorrelationSchemaVersion: 1,
      recovery,
    };
    const user = {
      id: userId,
      email: 'user@example.com',
      firstName: 'Ada',
      isActive: true,
      organizations: [
        {
          organizationId: 'org-1',
          organization: {
            id: 'org-1',
            name: 'Acme',
            emailSenderName: null,
            emailSenderAddress: null,
          },
        },
      ],
    };
    mocks.tokenFindUnique
      .mockResolvedValueOnce({ userId })
      .mockResolvedValueOnce(reset)
      .mockResolvedValueOnce({
        userId,
        requestId: 'request-1',
        organizationId: 'org-1',
        deliveryStatus: 'SENDING',
        deliveryAttempts: 1,
        providerAcceptedAt: null,
        provider: 'acs',
        providerMessageId: null,
        providerOperationId: flowId,
        providerCorrelationSchemaVersion: 1,
      });
    mocks.tokenFindFirst.mockResolvedValue({ id: flowId });
    mocks.recoveryFindUnique.mockImplementation(() => ({
      sendFence: 1,
      sendLeaseId: mocks.recoveryUpdateMany.mock.calls[0]?.[0]?.data?.sendLeaseId ?? null,
      wipedAt: null,
      providerOperationId: flowId,
    }));
    mocks.userFindUnique.mockResolvedValue(user);
    const tx = {
      passwordResetToken: {
        findUnique: mocks.tokenFindUnique,
        findFirst: mocks.tokenFindFirst,
        update: mocks.tokenUpdate,
        updateMany: mocks.tokenUpdateMany,
      },
      passwordResetRecovery: {
        findUnique: mocks.recoveryFindUnique,
        update: mocks.recoveryUpdate,
        updateMany: mocks.recoveryUpdateMany,
      },
      user: { findUnique: mocks.userFindUnique },
      $queryRaw: mocks.queryRaw,
      $executeRaw: mocks.executeRaw,
      event: {
        createMany: mocks.eventCreateMany,
        findUnique: mocks.eventFindUnique,
      },
    };
    mocks.transaction.mockImplementation(async (operation: unknown) =>
      Array.isArray(operation)
        ? Promise.all(operation)
        : (operation as (client: typeof tx) => Promise<unknown>)(tx)
    );
    return { pair, flowId, recovery, reset, user };
  }

  function job(flowId: string, deliveryAttempt = 1) {
    return {
      id: 'delivery-job',
      data: { schemaVersion: 1, flowId, deliveryAttempt },
    } as never;
  }

  function acceptanceJob(overrides: Record<string, unknown> = {}) {
    return {
      id: 'acceptance-job',
      data: {
        schemaVersion: 1,
        flowId: 'flow-1',
        provider: 'acs',
        providerMessageId: 'acs-message-1',
        providerAcceptedAt: new Date().toISOString(),
        sendFence: 1,
        requestId: 'request-1',
        ...overrides,
      },
    } as never;
  }

  it('constructs the bearer URL only in memory and persists first provider acceptance', async () => {
    const { pair, flowId } = arrange();
    mocks.sendEmail.mockResolvedValue({ messageId: 'acs-message-1' });

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        operationId: flowId,
        sensitiveContent: true,
        html: expect.stringContaining(`#token=${pair.publicToken}`),
      })
    );
    expect(mocks.addJob).toHaveBeenCalledWith(
      'normal',
      'password-reset.acceptance-reconcile',
      expect.objectContaining({
        flowId,
        provider: 'acs',
        providerMessageId: 'acs-message-1',
      }),
      expect.objectContaining({
        jobId: expect.stringContaining(`password-reset-${flowId}-accepted-`),
      })
    );
    expect(mocks.addJob.mock.calls[0]?.[2]).not.toHaveProperty('providerOperationId');
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: 'acs-message-1',
        }),
      })
    );
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ciphertext: null, keyId: null, wipedAt: expect.any(Date) }),
      })
    );
    expect(mocks.eventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'password-reset-flow-1-accepted-org-1',
        }),
        skipDuplicates: true,
      })
    );
    expect(mocks.executeRaw).toHaveBeenCalled();
    expect(mocks.executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.eventCreateMany.mock.invocationCallOrder[0]!
    );
    expect(JSON.stringify(mocks.addJob.mock.calls)).not.toContain(pair.publicToken);
  });

  it('delivers a version 2 recovery envelope using flow-bound authenticated data', async () => {
    const { pair, flowId } = arrange(2);
    mocks.sendEmail.mockResolvedValue({ messageId: 'acs-message-v2' });

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        operationId: flowId,
        sensitiveContent: true,
        html: expect.stringContaining(`#token=${pair.publicToken}`),
      })
    );
  });

  it('does not resend when both post-acceptance durability writes fail', async () => {
    const { flowId } = arrange();
    mocks.sendEmail.mockResolvedValue({ messageId: 'sensitive-provider-message' });
    mocks.addJob.mockRejectedValue(new Error('queue unavailable'));
    mocks.transaction.mockImplementationOnce(async (operation: unknown) => {
      const tx = {
        passwordResetToken: {
          findUnique: mocks.tokenFindUnique,
          findFirst: mocks.tokenFindFirst,
          update: mocks.tokenUpdate,
          updateMany: mocks.tokenUpdateMany,
        },
        passwordResetRecovery: {
          findUnique: mocks.recoveryFindUnique,
          update: mocks.recoveryUpdate,
          updateMany: mocks.recoveryUpdateMany,
        },
        user: { findUnique: mocks.userFindUnique },
        $queryRaw: mocks.queryRaw,
        $executeRaw: mocks.executeRaw,
        event: { createMany: mocks.eventCreateMany, findUnique: mocks.eventFindUnique },
      };
      return (operation as (client: typeof tx) => Promise<unknown>)(tx);
    });
    mocks.transaction.mockRejectedValueOnce(new Error('database unavailable after acceptance'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(processPasswordResetDeliveryJob(job(flowId))).resolves.toBeUndefined();

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.tokenUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'PROVIDER_ACCEPTED' }),
      })
    );
    const durabilityLog = consoleError.mock.calls.find((call) =>
      String(call[0]).includes('critical_both_writes_failed')
    );
    expect(durabilityLog).toBeDefined();
    expect(String(durabilityLog?.[0])).not.toContain('sensitive-provider-message');
    consoleError.mockRestore();
  });

  it('keeps provider acceptance durable when reconciliation enqueue fails', async () => {
    const { flowId } = arrange();
    const providerMessageSentinel = 'sensitive-provider-message';
    mocks.sendEmail.mockResolvedValue({ messageId: providerMessageSentinel });
    mocks.addJob.mockRejectedValue(new Error('queue unavailable'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: providerMessageSentinel,
        }),
      })
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('reconciliation_queue_failed_database_recorded')
    );
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(providerMessageSentinel);
    consoleWarn.mockRestore();
  });

  it('recovers a failed direct acceptance write from the independently queued job without resending', async () => {
    const { flowId } = arrange();
    const providerMessageSentinel = 'sensitive-provider-message';
    mocks.sendEmail.mockResolvedValue({ messageId: providerMessageSentinel });
    const transactionImplementation = mocks.transaction.getMockImplementation()!;
    mocks.transaction
      .mockImplementationOnce(transactionImplementation)
      .mockRejectedValueOnce(new Error('database unavailable after acceptance'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(mocks.addJob).toHaveBeenCalledOnce();
    expect(mocks.tokenUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'PROVIDER_ACCEPTED' }),
      })
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('database_write_failed_reconciliation_queued')
    );
    const queuedPayload = mocks.addJob.mock.calls[0]?.[2];
    expect(queuedPayload).toEqual(
      expect.objectContaining({
        flowId,
        providerMessageId: providerMessageSentinel,
      })
    );

    mocks.transaction.mockImplementation(transactionImplementation);
    await processPasswordResetAcceptanceJob({ id: 'acceptance-job', data: queuedPayload } as never);

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: providerMessageSentinel,
        }),
      })
    );
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(providerMessageSentinel);
    consoleWarn.mockRestore();
  });

  it('treats a retryable transport failure as acceptance unknown and never throws for retry', async () => {
    const { pair, flowId } = arrange();
    mocks.sendEmail.mockRejectedValue(
      new EmailDeliveryError({ code: 'EMAIL_ETIMEDOUT', provider: 'acs', retryable: true })
    );

    await expect(processPasswordResetDeliveryJob(job(flowId))).resolves.toBeUndefined();

    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'acs', providerOperationId: flowId }),
      })
    );
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'ACCEPTANCE_UNKNOWN' }),
      })
    );
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enqueueStatus: 'ACCEPTANCE_UNKNOWN',
          ciphertext: null,
        }),
      })
    );
    expect(mocks.addJob).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.eventCreateMany.mock.calls)).not.toContain(pair.publicToken);
  });

  it('preserves the encrypted envelope when its rotation key is temporarily unavailable', async () => {
    const { flowId } = arrange();
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'replacement-key';
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({
      'replacement-key': randomBytes(32).toString('base64'),
    });

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enqueueStatus: 'RECOVERY_BLOCKED_CONFIGURATION',
          deliveryAttempt: { increment: 1 },
          sendLeaseId: null,
          nextEnqueueAt: expect.any(Date),
        }),
      })
    );
    const transition = mocks.recoveryUpdate.mock.calls.at(-1)?.[0]?.data;
    expect(transition).not.toHaveProperty('ciphertext');
    expect(mocks.eventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'password-reset-flow-1-recovery-configuration-blocked-1-org-1',
        }),
      })
    );
  });

  it('delivers exactly once after a temporarily unavailable recovery key is restored', async () => {
    const { flowId, reset, recovery, user } = arrange();
    const configuredKeys = process.env['PASSWORD_RESET_RECOVERY_KEYS'];
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'replacement-key';
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({
      'replacement-key': randomBytes(32).toString('base64'),
    });

    await processPasswordResetDeliveryJob(job(flowId, 1));

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryAttempt: { increment: 1 },
          enqueueStatus: 'RECOVERY_BLOCKED_CONFIGURATION',
        }),
      })
    );

    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'test-key';
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = configuredKeys;
    const retryRecovery = { ...recovery, deliveryAttempt: 2, sendFence: 1 };
    const retryReset = {
      ...reset,
      deliveryStatus: 'RECOVERY_BLOCKED_CONFIGURATION',
      deliveryAttempts: 1,
      recovery: retryRecovery,
    };
    mocks.tokenFindUnique.mockReset();
    mocks.tokenFindUnique
      .mockResolvedValueOnce({ userId: reset.userId })
      .mockResolvedValueOnce(retryReset)
      .mockResolvedValueOnce({
        userId: reset.userId,
        requestId: reset.requestId,
        organizationId: reset.organizationId,
        deliveryStatus: 'SENDING',
        deliveryAttempts: 2,
        providerAcceptedAt: null,
        provider: 'acs',
        providerMessageId: null,
        providerOperationId: flowId,
        providerCorrelationSchemaVersion: 1,
      });
    mocks.userFindUnique.mockResolvedValue(user);
    mocks.recoveryFindUnique.mockResolvedValue({
      sendFence: 2,
      sendLeaseId: null,
      wipedAt: null,
      providerOperationId: flowId,
      enqueueStatus: 'SENDING',
    });
    mocks.sendEmail.mockResolvedValue({ messageId: 'acs-message-restored' });

    await processPasswordResetDeliveryJob(job(flowId, 2));

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: flowId, sensitiveContent: true })
    );
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: 'acs-message-restored',
        }),
      })
    );
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ciphertext: null, wipedAt: expect.any(Date) }),
      })
    );
  });

  it('wipes tampered recovery material and records an authenticated-decryption failure', async () => {
    const { flowId, recovery } = arrange();
    recovery.ciphertext = Buffer.from(recovery.ciphertext);
    recovery.ciphertext[0] = recovery.ciphertext[0]! ^ 0xff;

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enqueueStatus: 'RECOVERY_DECRYPT_FAILED',
          ciphertext: null,
          authTag: null,
          wipedAt: expect.any(Date),
        }),
      })
    );
  });

  it('does not mutate a stale delivery attempt', async () => {
    const { flowId } = arrange();

    await processPasswordResetDeliveryJob(job(flowId, 2));

    expect(mocks.recoveryUpdateMany).not.toHaveBeenCalled();
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
    expect(mocks.recoveryUpdate).not.toHaveBeenCalled();
    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('commits cancellation and audit when the account is no longer eligible', async () => {
    const { flowId, user } = arrange();
    user.isActive = false;

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enqueueStatus: 'CANCELLED', ciphertext: null }),
      })
    );
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: 'CANCELLED',
          deliveryErrorCode: 'FLOW_NOT_CURRENT',
        }),
      })
    );
    expect(mocks.eventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'password-reset-flow-1-cancelled-org-1',
        }),
      })
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('cancels a marked flow whose pinned recovery operation does not match the flow', async () => {
    const { flowId, reset } = arrange();
    reset.recovery.providerOperationId = 'wrong-operation';

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: 'CANCELLED',
          deliveryErrorCode: 'DELIVERY_CONTRACT_OPERATION_MISMATCH',
        }),
      })
    );
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enqueueStatus: 'CANCELLED', ciphertext: null }),
      })
    );
  });

  it('allows a QUEUE_RETRYING flow to be claimed by a fast recovery worker', async () => {
    const { flowId, reset } = arrange();
    reset.deliveryStatus = 'QUEUE_RETRYING';
    mocks.sendEmail.mockResolvedValue({ messageId: 'acs-message-1' });

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deliveryStatus: expect.objectContaining({
            in: expect.arrayContaining(['QUEUE_RETRYING']),
          }),
        }),
      })
    );
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it('does not switch providers when a recoverable delivery is retried', async () => {
    const { flowId, reset } = arrange();
    reset.deliveryStatus = 'RECOVERY_BLOCKED_CONFIGURATION';
    Object.assign(reset, { provider: 'smtp', deliveryAttempts: 0 });
    Object.assign(reset.recovery, { enqueueStatus: 'RECOVERY_BLOCKED_CONFIGURATION' });
    mocks.tokenFindUnique.mockReset();
    mocks.tokenFindUnique.mockResolvedValueOnce({ userId: reset.userId });
    mocks.tokenFindUnique.mockResolvedValueOnce(reset);

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: flowId, provider: 'smtp' }),
        data: expect.objectContaining({
          deliveryStatus: 'PROVIDER_CONFIGURATION_MISMATCH',
          deliveryErrorCode: 'PROVIDER_CHANGED_DURING_RETRY',
        }),
      })
    );
    expect(mocks.recoveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ flowId, wipedAt: null }),
        data: expect.objectContaining({
          enqueueStatus: 'PROVIDER_CONFIGURATION_MISMATCH',
          ciphertext: null,
          keyId: null,
          nonce: null,
          authTag: null,
          wipedAt: expect.any(Date),
        }),
      })
    );
    expect(mocks.eventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'password-reset-flow-1-provider-mismatch-1-org-1',
          metadata: expect.objectContaining({
            previousProvider: 'smtp',
            configuredProvider: 'acs',
          }),
        }),
      })
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('records a conflict and refuses provider acceptance with the wrong fence', async () => {
    mocks.tokenFindUnique.mockResolvedValue({
      userId: 'user-1',
      requestId: 'request-1',
      organizationId: 'org-1',
      provider: 'acs',
      providerMessageId: null,
      providerOperationId: 'flow-1',
      providerCorrelationSchemaVersion: 1,
    });
    mocks.recoveryFindUnique.mockResolvedValue({
      sendFence: 2,
      providerOperationId: 'flow-1',
    });
    mocks.userFindUnique.mockResolvedValue({ organizations: [{ organizationId: 'org-1' }] });

    await processPasswordResetAcceptanceJob(acceptanceJob());

    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
    expect(mocks.recoveryUpdate).not.toHaveBeenCalled();
    expect(mocks.eventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey:
            'password-reset-flow-1-provider-correlation-conflict-provider_acceptance_state_conflict-1-org-1',
          metadata: expect.objectContaining({
            errorCode: 'PROVIDER_ACCEPTANCE_STATE_CONFLICT',
          }),
        }),
      })
    );
  });

  it('records a conflict and refuses acceptance for a mismatched pinned operation', async () => {
    mocks.tokenFindUnique.mockResolvedValue({
      userId: 'user-1',
      requestId: 'request-1',
      organizationId: 'org-1',
      provider: 'acs',
      providerMessageId: null,
      providerOperationId: 'flow-1',
      providerCorrelationSchemaVersion: 1,
    });
    mocks.recoveryFindUnique.mockResolvedValue({
      sendFence: 1,
      providerOperationId: 'wrong-operation',
      enqueueStatus: 'SENDING',
      wipedAt: null,
    });

    await processPasswordResetAcceptanceJob(acceptanceJob());

    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
    expect(mocks.recoveryUpdate).not.toHaveBeenCalled();
    expect(mocks.eventCreateMany).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.eventCreateMany.mock.calls)).not.toContain('acs-message-1');
  });

  it('treats the same provider message as idempotent and a different message as a conflict', async () => {
    mocks.tokenFindUnique.mockResolvedValue({
      userId: 'user-1',
      requestId: 'request-1',
      organizationId: 'org-1',
      provider: 'acs',
      providerMessageId: 'acs-message-1',
      providerOperationId: 'flow-1',
      providerAcceptedAt: new Date('2026-07-31T00:00:00.000Z'),
      providerCorrelationSchemaVersion: 1,
      deliveryStatus: 'PROVIDER_ACCEPTED',
    });
    mocks.recoveryFindUnique.mockResolvedValue({
      sendFence: 1,
      providerOperationId: 'flow-1',
    });
    mocks.userFindUnique.mockResolvedValue({ organizations: [{ organizationId: 'org-1' }] });

    await processPasswordResetAcceptanceJob(acceptanceJob());
    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
    expect(mocks.eventCreateMany).not.toHaveBeenCalled();

    await processPasswordResetAcceptanceJob(
      acceptanceJob({ providerMessageId: 'acs-message-conflict' })
    );
    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
    expect(mocks.eventCreateMany).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.eventCreateMany.mock.calls)).not.toContain('acs-message-conflict');
  });

  it('terminalizes a protected registry conflict without exposing the provider identifier', async () => {
    const providerMessageSentinel = 'sentinel-provider-message-id';
    mocks.tokenFindUnique.mockResolvedValue({
      userId: 'user-1',
      requestId: 'request-1',
      organizationId: 'org-1',
      auditOrganizationIds: ['org-1'],
    });
    const transactionImplementation = mocks.transaction.getMockImplementation()!;
    mocks.transaction
      .mockRejectedValueOnce(
        new Error(`PASSWORD_RESET_PROVIDER_CORRELATION_CONFLICT near ${providerMessageSentinel}`)
      )
      .mockImplementation(transactionImplementation);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = processPasswordResetAcceptanceJob(
      acceptanceJob({ providerMessageId: providerMessageSentinel })
    );

    await expect(result).rejects.toMatchObject({
      name: 'UnrecoverableError',
      message: 'Password reset provider correlation persistence conflict',
    });
    await result.catch((error: Error) => {
      expect(error.stack).not.toContain(providerMessageSentinel);
    });
    expect(mocks.eventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            errorCode: 'PASSWORD_RESET_PROVIDER_CORRELATION_CONFLICT',
          }),
        }),
      })
    );
    expect(JSON.stringify(mocks.eventCreateMany.mock.calls)).not.toContain(providerMessageSentinel);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(providerMessageSentinel);
    consoleError.mockRestore();
  });

  it('retries a failed categorical conflict audit without calling the provider', async () => {
    const providerMessageSentinel = 'sentinel-provider-message-id';
    mocks.transaction
      .mockRejectedValueOnce(
        new Error(`PASSWORD_RESET_PROVIDER_CORRELATION_CONFLICT near ${providerMessageSentinel}`)
      )
      .mockRejectedValueOnce(new Error(`audit unavailable near ${providerMessageSentinel}`));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = processPasswordResetAcceptanceJob(
      acceptanceJob({ providerMessageId: providerMessageSentinel })
    );

    await expect(result).rejects.toMatchObject({
      name: 'RetryableProviderCorrelationAuditError',
      message: 'Password reset provider correlation audit persistence is temporarily unavailable',
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('audit_retry_required'));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(providerMessageSentinel);
    consoleError.mockRestore();
  });

  it('reports that no tenant audit was recorded when the conflicted flow no longer exists', async () => {
    const transactionImplementation = mocks.transaction.getMockImplementation()!;
    mocks.transaction
      .mockRejectedValueOnce(new Error('PASSWORD_RESET_PROVIDER_CORRELATION_CONFLICT'))
      .mockImplementation(transactionImplementation);
    mocks.tokenFindUnique.mockResolvedValue(null);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(processPasswordResetAcceptanceJob(acceptanceJob())).rejects.toMatchObject({
      name: 'UnrecoverableError',
    });

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('"auditRecorded":false'));
    expect(mocks.eventCreateMany).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('rejects an unknown provider label without logging the supplied value', async () => {
    const providerSentinel = 'sentinel-provider-message-used-as-provider';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      processPasswordResetAcceptanceJob(acceptanceJob({ provider: providerSentinel }))
    ).rejects.toMatchObject({ name: 'UnrecoverableError' });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('UNSUPPORTED_PROVIDER'));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(providerSentinel);
    consoleError.mockRestore();
  });

  it('reports critical durability when conflict audit and reconciliation enqueue both fail', async () => {
    const { flowId } = arrange();
    const providerMessageSentinel = 'sensitive-provider-message';
    mocks.sendEmail.mockResolvedValue({ messageId: providerMessageSentinel });
    mocks.addJob.mockRejectedValue(new Error('queue unavailable'));
    const transactionImplementation = mocks.transaction.getMockImplementation()!;
    mocks.transaction
      .mockImplementationOnce(transactionImplementation)
      .mockRejectedValueOnce(
        new Error(`PASSWORD_RESET_PROVIDER_CORRELATION_CONFLICT near ${providerMessageSentinel}`)
      )
      .mockRejectedValueOnce(new Error(`audit unavailable near ${providerMessageSentinel}`));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await processPasswordResetDeliveryJob(job(flowId));

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('critical_conflict_audit_and_reconciliation_failed')
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(providerMessageSentinel);
    consoleError.mockRestore();
  });

  it('retries only an allowlisted transient acceptance persistence error', async () => {
    mocks.tokenFindUnique.mockResolvedValue({
      userId: 'user-1',
      requestId: 'request-1',
      organizationId: 'org-1',
      provider: 'acs',
      providerMessageId: null,
      providerOperationId: 'flow-1',
      providerCorrelationSchemaVersion: 1,
    });
    mocks.recoveryFindUnique.mockResolvedValue({
      sendFence: 1,
      providerOperationId: 'flow-1',
      enqueueStatus: 'SENDING',
      wipedAt: null,
    });
    mocks.transaction
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('transaction conflict', {
          code: 'P2034',
          clientVersion: '5.22.0',
        })
      )
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('transaction conflict', {
          code: 'P2034',
          clientVersion: '5.22.0',
        })
      );

    await expect(processPasswordResetAcceptanceJob(acceptanceJob())).resolves.toBeUndefined();

    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.tokenUpdate).toHaveBeenCalledOnce();
  });

  it('surfaces exhausted P1001 initialization failures as a bounded retryable error', async () => {
    const providerMessageSentinel = 'sentinel-provider-message-id';
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientInitializationError(
        `database unavailable near ${providerMessageSentinel}`,
        '5.22.0',
        'P1001'
      )
    );

    const result = processPasswordResetAcceptanceJob(
      acceptanceJob({ providerMessageId: providerMessageSentinel })
    );

    await expect(result).rejects.toMatchObject({
      name: 'RetryableAcceptancePersistenceError',
      message: 'Password reset acceptance persistence is temporarily unavailable',
    });
    await result.catch((error: Error) => {
      expect(error.stack).not.toContain(providerMessageSentinel);
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });

  it('rejects an unsupported acceptance payload schema before touching the database', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      processPasswordResetAcceptanceJob(acceptanceJob({ schemaVersion: 2 }))
    ).rejects.toMatchObject({
      name: 'UnrecoverableError',
      message: 'Invalid password reset acceptance payload',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('provider_acceptance_job_rejected')
    );
    consoleError.mockRestore();
  });

  it('marks a non-transient acceptance persistence failure unrecoverable', async () => {
    const providerMessageSentinel = 'sentinel-provider-message-id';
    mocks.transaction.mockRejectedValue(
      new Error(`deterministic schema mismatch near ${providerMessageSentinel}`)
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = processPasswordResetAcceptanceJob(
      acceptanceJob({ providerMessageId: providerMessageSentinel })
    );
    await expect(result).rejects.toMatchObject({
      name: 'UnrecoverableError',
      message: 'Password reset acceptance persistence is not retryable',
    });
    await result.catch((error: Error) => {
      expect(error.stack).not.toContain(providerMessageSentinel);
    });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(providerMessageSentinel);
    consoleError.mockRestore();
  });
});
