import { randomBytes } from 'crypto';
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
import { encryptPasswordResetRecoveryToken } from '@/lib/auth/passwordResetRecovery';
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

  function arrange() {
    const flowId = 'flow-1';
    const userId = 'user-1';
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const pair = createPasswordResetToken();
    const envelope = encryptPasswordResetRecoveryToken(pair.publicToken, 'user@example.com', {
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
        provider: null,
        providerMessageId: null,
        providerOperationId: flowId,
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
        providerOperationId: 'flow-1',
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
        provider: null,
        providerMessageId: null,
        providerOperationId: flowId,
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
      provider: null,
      providerMessageId: null,
      providerOperationId: 'flow-1',
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
          idempotencyKey: expect.stringMatching(
            /^password-reset-flow-1-acceptance-conflict-[a-f0-9]{16}-org-1$/
          ),
        }),
      })
    );
  });

  it('treats the same provider message as idempotent and a different message as a conflict', async () => {
    mocks.tokenFindUnique.mockResolvedValue({
      userId: 'user-1',
      requestId: 'request-1',
      organizationId: 'org-1',
      provider: 'acs',
      providerMessageId: 'acs-message-1',
      providerOperationId: 'flow-1',
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
  });
});
