import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tokenFindUnique: vi.fn(),
  tokenUpdateMany: vi.fn(),
  recoveryUpdateMany: vi.fn(),
  recoveryFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  transaction: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const client = {
    emailVerificationToken: {
      findUnique: mocks.tokenFindUnique,
      updateMany: mocks.tokenUpdateMany,
    },
    emailVerificationRecovery: {
      findUnique: mocks.recoveryFindUnique,
      updateMany: mocks.recoveryUpdateMany,
    },
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  };
  return { bootstrapDb: client };
});

vi.mock('@/lib/auth/emailVerificationDelivery', () => ({
  buildEmailVerificationUrl: (token: string) =>
    `https://app.example.com/auth/verify-email?token=${token}`,
}));

vi.mock('@/lib/auth/emailVerificationDeliveryContract', () => ({
  decryptEmailVerificationRecoveryToken: () => `evt1_${'a'.repeat(43)}`,
  EmailVerificationDeliveryContractError: class EmailVerificationDeliveryContractError extends Error {},
}));

vi.mock('@/providers', () => ({
  getConfiguredEmailProviderName: () => 'acs',
  getProviders: () => ({ email: { providerName: 'acs', sendEmail: mocks.sendEmail } }),
}));

vi.mock('@/providers/email/errors', () => ({
  normalizeEmailError: () => ({ code: 'EMAIL_UNKNOWN', retryable: false }),
}));

import { processEmailVerificationDeliveryJob } from './emailVerificationDeliveryProcessor';

describe('email verification delivery processor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const tx = {
      emailVerificationToken: {
        findUnique: mocks.tokenFindUnique,
        updateMany: mocks.tokenUpdateMany,
      },
      emailVerificationRecovery: {
        findUnique: mocks.recoveryFindUnique,
        updateMany: mocks.recoveryUpdateMany,
      },
      user: { findUnique: mocks.userFindUnique },
    };
    mocks.transaction.mockImplementation(
      async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)
    );
    mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
    mocks.recoveryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.recoveryFindUnique.mockResolvedValue({ sendFence: 7 });
    mocks.userFindUnique.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Ada',
      isActive: true,
      emailVerifiedAt: null,
    });
    mocks.tokenFindUnique.mockResolvedValue({
      id: 'flow-1',
      userId: 'user-1',
      token: 'stored-token',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      providerAcceptedAt: null,
      deliveryContractVersion: 1,
      deliveryStatus: 'QUEUED',
      recovery: {
        keyId: 'verify-v1',
        nonce: Buffer.alloc(12),
        ciphertext: Buffer.alloc(64),
        authTag: Buffer.alloc(16),
        recipientFingerprint: 'fingerprint',
        wipedAt: null,
        sendLeaseExpiresAt: null,
        sendFence: 1,
      },
    });
  });

  it('records a post-acceptance persistence conflict as acceptance unknown using the persisted fence', async () => {
    mocks.sendEmail.mockResolvedValue({ messageId: 'acs-message-1' });
    mocks.tokenUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.recoveryUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      processEmailVerificationDeliveryJob({
        data: { schemaVersion: 1, flowId: 'flow-1' },
        attemptsMade: 0,
      } as never)
    ).rejects.toThrow('EMAIL_UNKNOWN');

    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recovery: { is: expect.objectContaining({ sendFence: 7 }) },
        }),
      })
    );
    expect(mocks.tokenUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'ACCEPTANCE_UNKNOWN' }),
      })
    );
  });
});
