import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recoveryFindMany: vi.fn(),
  recoveryFindUnique: vi.fn(),
  recoveryCreate: vi.fn(),
  recoveryUpdate: vi.fn(),
  recoveryUpdateMany: vi.fn(),
  tokenFindUnique: vi.fn(),
  tokenCreate: vi.fn(),
  tokenUpdate: vi.fn(),
  tokenUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  eventCreateMany: vi.fn(),
  eventFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  addJob: vi.fn(),
  getJobStatus: vi.fn(),
  waitUntilReady: vi.fn(),
  closeJobProvider: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const client = {
    passwordResetRecovery: {
      findMany: mocks.recoveryFindMany,
      findUnique: mocks.recoveryFindUnique,
      create: mocks.recoveryCreate,
      update: mocks.recoveryUpdate,
      updateMany: mocks.recoveryUpdateMany,
    },
    passwordResetToken: {
      findUnique: mocks.tokenFindUnique,
      create: mocks.tokenCreate,
      update: mocks.tokenUpdate,
      updateMany: mocks.tokenUpdateMany,
    },
    user: { findUnique: mocks.userFindUnique },
    userOrganization: { findFirst: mocks.membershipFindFirst },
    event: {
      createMany: mocks.eventCreateMany,
      findUnique: mocks.eventFindUnique,
    },
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
    $disconnect: vi.fn(),
  };
  return {
    bootstrapDb: client,
    setBootstrapContext: (tx: typeof client) => tx.$executeRaw(),
  };
});

vi.mock('@/providers', () => ({
  createJobProvider: () => ({
    addJob: mocks.addJob,
    getJobStatus: mocks.getJobStatus,
    waitUntilReady: mocks.waitUntilReady,
    close: mocks.closeJobProvider,
  }),
}));

import {
  preflightPasswordResetRecovery,
  reconcilePasswordResetDeliveries,
} from './passwordResetReconciler';

describe('password reset reconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    mocks.queryRaw.mockResolvedValue([]);
    mocks.executeRaw.mockResolvedValue(1);
    mocks.recoveryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.recoveryCreate.mockResolvedValue({});
    mocks.recoveryUpdate.mockResolvedValue({ enqueueStatus: 'PREFLIGHT_VERIFIED' });
    mocks.tokenCreate.mockResolvedValue({});
    mocks.tokenUpdate.mockResolvedValue({});
    mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
    mocks.recoveryFindUnique.mockResolvedValue({ wipedAt: null, sendFence: 4 });
    mocks.tokenFindUnique.mockResolvedValue({
      userId: 'user-1',
      requestId: 'request-1',
      organizationId: 'org-1',
      deliveryStatus: 'SENDING',
      providerAcceptedAt: null,
    });
    mocks.userFindUnique.mockResolvedValue({ organizations: [{ organizationId: 'org-1' }] });
    mocks.membershipFindFirst.mockResolvedValue({ userId: 'user-1', organizationId: 'org-1' });
    mocks.eventCreateMany.mockResolvedValue({ count: 1 });
    mocks.eventFindUnique.mockResolvedValue({ id: 'event-1', organizationId: 'org-1' });
    mocks.addJob.mockResolvedValue('password-reset-flow-1-delivery-1');
    mocks.waitUntilReady.mockResolvedValue(undefined);
    mocks.closeJobProvider.mockResolvedValue(undefined);
    const tx = {
      passwordResetRecovery: {
        findUnique: mocks.recoveryFindUnique,
        create: mocks.recoveryCreate,
        update: mocks.recoveryUpdate,
        updateMany: mocks.recoveryUpdateMany,
      },
      passwordResetToken: {
        findUnique: mocks.tokenFindUnique,
        create: mocks.tokenCreate,
        update: mocks.tokenUpdate,
        updateMany: mocks.tokenUpdateMany,
      },
      user: { findUnique: mocks.userFindUnique },
      userOrganization: { findFirst: mocks.membershipFindFirst },
      event: {
        createMany: mocks.eventCreateMany,
        findUnique: mocks.eventFindUnique,
      },
      $queryRaw: mocks.queryRaw,
      $executeRaw: mocks.executeRaw,
    };
    mocks.transaction.mockImplementation(async (operation: unknown) =>
      Array.isArray(operation)
        ? Promise.all(operation)
        : (operation as (client: typeof tx) => Promise<unknown>)(tx)
    );
  });

  it('marks an expired send lease acceptance unknown without creating a delivery job', async () => {
    mocks.recoveryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ flowId: 'flow-stale', sendFence: 4 }])
      .mockResolvedValueOnce([]);

    const summary = await reconcilePasswordResetDeliveries();

    expect(summary.staleSendingUnknown).toBe(1);
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'flow-stale' },
        data: expect.objectContaining({ deliveryStatus: 'ACCEPTANCE_UNKNOWN' }),
      })
    );
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { flowId: 'flow-stale' },
        data: expect.objectContaining({
          enqueueStatus: 'ACCEPTANCE_UNKNOWN',
          ciphertext: null,
        }),
      })
    );
    expect(mocks.addJob).not.toHaveBeenCalled();
    expect(mocks.waitUntilReady).toHaveBeenCalledWith('normal');
    expect(mocks.closeJobProvider).toHaveBeenCalledOnce();
  });

  it('preflights Redis and rolls back runtime recovery and audit mutations', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { current_user: 'vaultspace_app', bypasses_rls: false, is_superuser: false },
    ]);

    await preflightPasswordResetRecovery();

    expect(mocks.waitUntilReady).toHaveBeenCalledWith('normal');
    expect(mocks.tokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.stringMatching(/^preflight-/),
        userId: 'user-1',
        organizationId: 'org-1',
      }),
    });
    expect(mocks.recoveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowId: expect.stringMatching(/^preflight-/),
        ciphertext: expect.any(Buffer),
      }),
    });
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { enqueueStatus: 'PREFLIGHT_VERIFIED' } })
    );
    expect(mocks.eventCreateMany).toHaveBeenCalled();
    expect(mocks.closeJobProvider).toHaveBeenCalledOnce();
  });

  it('rejects a superuser database role during preflight', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { current_user: 'postgres', bypasses_rls: false, is_superuser: true },
    ]);

    await expect(preflightPasswordResetRecovery()).rejects.toThrow(/non-superuser/i);

    expect(mocks.tokenCreate).not.toHaveBeenCalled();
    expect(mocks.closeJobProvider).toHaveBeenCalledOnce();
  });

  it('fails closed before constructing a queue client when Redis is missing', async () => {
    delete process.env['REDIS_URL'];

    await expect(preflightPasswordResetRecovery()).rejects.toThrow(/REDIS_URL is required/i);

    expect(mocks.waitUntilReady).not.toHaveBeenCalled();
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
  });

  it('claims queue recovery in PostgreSQL and enqueues an attempt-qualified flow-only job', async () => {
    mocks.recoveryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          flowId: 'flow-1',
          enqueueStatus: 'PENDING',
          enqueueAttempts: 0,
          deliveryAttempt: 1,
          resetToken: {
            userId: 'user-1',
            queueJobId: null,
            deliveryStatus: 'PENDING',
          },
        },
      ]);

    const summary = await reconcilePasswordResetDeliveries();

    expect(summary.enqueued).toBe(1);
    expect(mocks.recoveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enqueueStatus: 'ENQUEUE_CLAIMED',
          enqueueLeaseId: expect.any(String),
          enqueueLeaseExpiresAt: expect.any(Date),
        }),
      })
    );
    expect(mocks.addJob).toHaveBeenCalledWith(
      'normal',
      'password-reset.deliver',
      { schemaVersion: 1, flowId: 'flow-1', deliveryAttempt: 1 },
      expect.objectContaining({ jobId: 'password-reset-flow-1-delivery-1' })
    );
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'flow-1',
          deliveryStatus: {
            in: ['PENDING', 'QUEUE_RETRYING', 'QUEUED', 'RECOVERY_BLOCKED_CONFIGURATION'],
          },
        }),
        data: { deliveryStatus: 'QUEUED', queueJobId: 'password-reset-flow-1-delivery-1' },
      })
    );
    expect(mocks.closeJobProvider).toHaveBeenCalledOnce();
  });

  it('atomically defers and audits queue recovery when Redis remains unavailable', async () => {
    mocks.recoveryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          flowId: 'flow-1',
          enqueueStatus: 'QUEUE_RETRYING',
          enqueueAttempts: 1,
          deliveryAttempt: 1,
          resetToken: {
            userId: 'user-1',
            queueJobId: null,
            deliveryStatus: 'QUEUE_RETRYING',
          },
        },
      ]);
    mocks.addJob.mockRejectedValue(new Error('redis unavailable'));
    mocks.tokenFindUnique.mockResolvedValue({
      userId: 'user-1',
      requestId: 'request-1',
      organizationId: 'org-1',
      deliveryStatus: 'QUEUE_RETRYING',
      providerAcceptedAt: null,
    });
    mocks.recoveryFindUnique.mockImplementation(() => ({
      wipedAt: null,
      enqueueStatus: 'ENQUEUE_CLAIMED',
      enqueueLeaseId: mocks.recoveryUpdateMany.mock.calls[0]?.[0]?.data?.enqueueLeaseId,
    }));

    const summary = await reconcilePasswordResetDeliveries();

    expect(summary.queueDeferred).toBe(1);
    expect(mocks.tokenUpdate).toHaveBeenCalledWith({
      where: { id: 'flow-1' },
      data: { deliveryStatus: 'QUEUE_RETRYING', deliveryErrorCode: 'EMAIL_QUEUE_ERROR' },
    });
    expect(mocks.recoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { flowId: 'flow-1' },
        data: expect.objectContaining({
          enqueueStatus: 'QUEUE_RETRYING',
          enqueueLeaseId: null,
          nextEnqueueAt: expect.any(Date),
        }),
      })
    );
    expect(mocks.eventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'password-reset-flow-1-queue-recovery-deferred-2-org-1',
        }),
      })
    );
    expect(mocks.closeJobProvider).toHaveBeenCalledOnce();
  });

  it('closes the queue provider when reconciliation fails', async () => {
    mocks.recoveryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          flowId: 'flow-1',
          enqueueStatus: 'QUEUED',
          enqueueAttempts: 1,
          deliveryAttempt: 1,
          resetToken: {
            userId: 'user-1',
            queueJobId: 'job-1',
            deliveryStatus: 'QUEUED',
          },
        },
      ]);
    mocks.getJobStatus.mockRejectedValue(new Error('redis unavailable'));

    await expect(reconcilePasswordResetDeliveries()).rejects.toThrow('redis unavailable');

    expect(mocks.closeJobProvider).toHaveBeenCalledOnce();
  });

  it('fails and closes the provider when Redis is unavailable with an empty backlog', async () => {
    mocks.recoveryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.waitUntilReady.mockRejectedValue(new Error('redis unavailable'));

    await expect(reconcilePasswordResetDeliveries()).rejects.toThrow('redis unavailable');

    expect(mocks.addJob).not.toHaveBeenCalled();
    expect(mocks.closeJobProvider).toHaveBeenCalledOnce();
  });
});
