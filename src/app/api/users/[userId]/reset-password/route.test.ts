/**
 * Admin-triggered Password Reset API tests
 *
 * POST /api/users/:userId/reset-password
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { decryptPasswordResetRecoveryToken } from '@/lib/auth/passwordResetRecovery';

vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
  getRequestContext: vi.fn(() => ({
    requestId: 'req-admin-reset',
    ipAddress: '192.0.2.30',
    userAgent: 'admin-reset-test-agent',
  })),
}));
vi.mock('@/lib/db', () => {
  const bootstrapClient = {
    passwordResetToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    passwordResetRecovery: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    userOrganization: { findMany: vi.fn() },
    event: { upsert: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  bootstrapClient.$transaction.mockImplementation(async (operation: unknown) =>
    Array.isArray(operation)
      ? Promise.all(operation)
      : (operation as (client: typeof bootstrapClient) => Promise<unknown>)(bootstrapClient)
  );
  return { withOrgContext: vi.fn(), bootstrapDb: bootstrapClient };
});
vi.mock('@/providers', () => ({
  getConfiguredEmailProviderName: () => 'acs',
  getProviders: vi.fn(),
}));
vi.mock('@/lib/deployment-capabilities', () => ({ hasCapability: vi.fn() }));
const mockCreateSecurityAuditEvent = vi.fn();
const mockCaptureSecurityAudit = vi.fn();
vi.mock('@/lib/audit/securityAudit', () => ({
  createSecurityAuditEvent: (...args: unknown[]) => mockCreateSecurityAuditEvent(...args),
  captureSecurityAudit: (...args: unknown[]) => mockCaptureSecurityAudit(...args),
}));
vi.mock('@/workers/types', () => ({
  JOB_NAMES: {
    EMAIL_SEND: 'email.send',
    PASSWORD_RESET_DELIVER: 'password-reset.deliver',
  },
  QUEUE_NAMES: { NORMAL: 'normal' },
  PASSWORD_RESET_EMAIL_JOB_OPTIONS: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
  PASSWORD_RESET_RECOVERY_JOB_OPTIONS: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  },
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext, bootstrapDb } from '@/lib/db';
import { getProviders } from '@/providers';
import { hasCapability } from '@/lib/deployment-capabilities';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);
const mockInvalidateToken = vi.mocked(bootstrapDb.passwordResetToken.updateMany);
const mockFindTokenState = vi.mocked(bootstrapDb.passwordResetToken.findUnique);
const mockUpdateTokenState = vi.mocked(bootstrapDb.passwordResetToken.update);
const mockFindRecoveryState = vi.mocked(bootstrapDb.passwordResetRecovery.findUnique);
const mockUpdateRecoveryState = vi.mocked(bootstrapDb.passwordResetRecovery.update);
const mockGetProviders = vi.mocked(getProviders);
const mockHasCapability = vi.mocked(hasCapability);
const mockAddJob = vi.fn();
const mockSendEmail = vi.fn();

type Session = ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never;

describe('POST /api/users/:userId/reset-password', () => {
  const adminSession = {
    userId: 'admin-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
    user: { email: 'admin@example.com' },
  };
  const OLD_APP_URL = process.env['APP_URL'];
  const OLD_SESSION_SECRET = process.env['SESSION_SECRET'];
  const OLD_WRITE_MODE = process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'];
  const OLD_RECOVERY_KEYS = process.env['PASSWORD_RESET_RECOVERY_KEYS'];
  const OLD_RECOVERY_ACTIVE_KEY = process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['APP_URL'] = 'https://app.example.com';
    process.env['SESSION_SECRET'] = 'test-session-secret';
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'test-key';
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({
      'test-key': Buffer.alloc(32, 9).toString('base64'),
    });
    mockRequireAuth.mockResolvedValue(adminSession as Session);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendAsyncEmail');
    mockGetProviders.mockReturnValue({
      job: { addJob: mockAddJob },
      email: { providerName: 'acs', sendEmail: mockSendEmail },
    } as unknown as ReturnType<typeof getProviders>);
    mockAddJob.mockResolvedValue('job-1');
    mockCreateSecurityAuditEvent.mockResolvedValue('event-1');
    mockCaptureSecurityAudit.mockResolvedValue('captured');
    mockInvalidateToken.mockResolvedValue({ count: 1 } as never);
    mockFindTokenState.mockResolvedValue({
      deliveryStatus: 'PENDING',
      providerAcceptedAt: null,
    } as never);
    mockFindRecoveryState.mockResolvedValue({
      enqueueStatus: 'PENDING',
      wipedAt: null,
    } as never);
    mockUpdateTokenState.mockResolvedValue({} as never);
    mockUpdateRecoveryState.mockResolvedValue({} as never);
    vi.mocked(bootstrapDb.userOrganization.findMany).mockResolvedValue([
      { organizationId: 'org-1' },
    ] as never);
    vi.mocked(bootstrapDb.$queryRaw).mockResolvedValue([] as never);
  });

  afterEach(() => {
    process.env['APP_URL'] = OLD_APP_URL;
    if (OLD_SESSION_SECRET === undefined) {
      delete process.env['SESSION_SECRET'];
    } else {
      process.env['SESSION_SECRET'] = OLD_SESSION_SECRET;
    }
    if (OLD_WRITE_MODE === undefined) {
      delete process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'];
    } else {
      process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = OLD_WRITE_MODE;
    }
    if (OLD_RECOVERY_KEYS === undefined) {
      delete process.env['PASSWORD_RESET_RECOVERY_KEYS'];
    } else {
      process.env['PASSWORD_RESET_RECOVERY_KEYS'] = OLD_RECOVERY_KEYS;
    }
    if (OLD_RECOVERY_ACTIVE_KEY === undefined) {
      delete process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'];
    } else {
      process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = OLD_RECOVERY_ACTIVE_KEY;
    }
  });

  function resetTx(userOverride: Record<string, unknown> = {}, recentToken: unknown = null) {
    return {
      userOrganization: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'uo-2',
          userId: 'user-2',
          organizationId: 'org-1',
          isActive: true,
          user: {
            id: 'user-2',
            email: 'user@example.com',
            firstName: 'Existing',
            isActive: true,
            ...userOverride,
          },
          organization: { isActive: true },
        }),
      },
      passwordResetToken: {
        findFirst: vi.fn().mockResolvedValue(recentToken),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
      passwordResetRecovery: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          name: 'Acme',
          emailSenderName: 'Acme Data Room',
          emailSenderAddress: 'dataroom@acme.example',
        }),
      },
      event: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
  }
  const useTx = (tx: Record<string, unknown>) =>
    mockWithOrgContext.mockImplementation(async (_orgId, callback) =>
      callback(tx as unknown as Parameters<typeof callback>[0])
    );
  const req = () =>
    new NextRequest('http://localhost/api/users/user-2/reset-password', { method: 'POST' });
  const ctx = { params: Promise.resolve({ userId: 'user-2' }) };

  it('returns 403 for non-admin callers', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'viewer-1',
      organizationId: 'org-1',
      organization: { role: 'VIEWER' },
      user: { email: 'viewer@example.com' },
    } as Session);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('returns 503 when no email capability, without minting a token', async () => {
    mockHasCapability.mockReturnValue(false);
    const tx = resetTx();
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(503);
    // withOrgContext is never entered — token/tx work is skipped entirely.
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('fails before provider or transaction work when the reset secret is missing', async () => {
    delete process.env['SESSION_SECRET'];

    const res = await POST(req(), ctx);

    expect(res.status).toBe(500);
    expect(mockGetProviders).not.toHaveBeenCalled();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('fails before provider or transaction work when HMAC recovery keys are missing', async () => {
    delete process.env['PASSWORD_RESET_RECOVERY_KEYS'];

    const res = await POST(req(), ctx);

    expect(res.status).toBe(500);
    expect(mockGetProviders).not.toHaveBeenCalled();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('fails before transaction work when HMAC delivery has no async worker', async () => {
    mockHasCapability.mockImplementation((cap) => cap === 'canSendSyncEmail');

    const res = await POST(req(), ctx);

    expect(res.status).toBe(503);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('returns 404 when the target is not a member of the org', async () => {
    useTx({
      userOrganization: { findFirst: vi.fn().mockResolvedValue(null) },
      $executeRaw: vi.fn().mockResolvedValue(1),
    });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('refuses a globally deactivated account (400) without a token', async () => {
    const tx = resetTx({ isActive: false });
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('refuses a deactivated MEMBERSHIP (400) even if the global account is active', async () => {
    const tx = resetTx();
    tx.userOrganization.findFirst = vi.fn().mockResolvedValue({
      id: 'uo-2',
      userId: 'user-2',
      organizationId: 'org-1',
      isActive: false, // membership disabled in this org
      user: { id: 'user-2', email: 'user@example.com', firstName: 'X', isActive: true },
    });
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('enforces a cooldown (429) when a fresh token was just issued', async () => {
    const tx = resetTx({}, { id: 'recent-token' });
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(429);
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('returns 202 and preserves a recoverable token when the queue is unavailable', async () => {
    vi.mocked(bootstrapDb.userOrganization.findMany).mockResolvedValue([
      { organizationId: 'org-2' },
      { organizationId: 'org-1' },
    ] as never);
    const tx = resetTx();
    useTx(tx);
    mockAddJob.mockRejectedValue(new Error('queue down'));
    mockInvalidateToken.mockResolvedValue({ count: 1 } as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ success: true, deliveryPending: true });
    expect(tx.passwordResetToken.create).toHaveBeenCalled();
    expect(mockUpdateTokenState).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: expect.objectContaining({
        deliveryStatus: 'QUEUE_RETRYING',
      }),
    });
    expect(mockInvalidateToken).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) })
    );
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        organizationId: 'org-2',
        idempotencyKey: expect.stringMatching(/queue-recovery-pending-org-2$/),
        metadata: expect.objectContaining({ auditScopeSource: 'captured_snapshot' }),
      })
    );
  });

  it('records retryable synchronous submission failure as acceptance unknown', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
    const tx = resetTx();
    useTx(tx);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendSyncEmail');
    mockSendEmail.mockRejectedValue({ statusCode: 503 });
    vi.mocked(bootstrapDb.userOrganization.findMany).mockResolvedValue([
      { organizationId: 'org-2' },
      { organizationId: 'org-1' },
    ] as never);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(502);
    expect(mockInvalidateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'acs', providerOperationId: expect.any(String) }),
      })
    );
    expect(mockInvalidateToken).toHaveBeenLastCalledWith({
      where: { id: expect.any(String), usedAt: null },
      data: expect.objectContaining({
        deliveryStatus: 'ACCEPTANCE_UNKNOWN',
        deliveryErrorCode: 'EMAIL_PROVIDER_UNAVAILABLE',
      }),
    });
    expect(mockInvalidateToken.mock.calls.at(-1)?.[0]?.data).not.toHaveProperty('usedAt');
    expect(mockCaptureSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-2',
        metadata: expect.objectContaining({
          stage: 'provider_submission',
          auditScopeSource: 'captured_snapshot',
          retryable: true,
        }),
      })
    );
  });

  it('records permanent synchronous submission rejection as permanent', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
    const tx = resetTx();
    useTx(tx);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendSyncEmail');
    mockSendEmail.mockRejectedValue({ statusCode: 400 });
    vi.mocked(bootstrapDb.userOrganization.findMany).mockResolvedValue([
      { organizationId: 'org-2' },
      { organizationId: 'org-1' },
    ] as never);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(502);
    expect(mockInvalidateToken).toHaveBeenLastCalledWith({
      where: { id: expect.any(String), usedAt: null },
      data: expect.objectContaining({
        deliveryStatus: 'FAILED_PERMANENT',
        deliveryErrorCode: 'EMAIL_HTTP_400',
      }),
    });
    expect(mockCaptureSecurityAudit).toHaveBeenCalledTimes(2);
    expect(mockCaptureSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-2',
        metadata: expect.objectContaining({ auditScopeSource: 'captured_snapshot' }),
      })
    );
  });

  it('keeps an accepted synchronous reset valid when lifecycle persistence fails', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
    const tx = resetTx();
    useTx(tx);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendSyncEmail');
    mockSendEmail.mockResolvedValue({ messageId: 'provider-message-1' });
    mockInvalidateToken
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockRejectedValueOnce(new Error('database unavailable after acceptance'));

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockCaptureSecurityAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'USER_PASSWORD_RESET' })
    );
    expect(mockInvalidateToken).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) })
    );
  });

  it('records immutable provider acceptance for an administrator synchronous reset', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
    mockHasCapability.mockImplementation((cap) => cap === 'canSendSyncEmail');
    const tx = resetTx();
    useTx(tx);
    mockSendEmail.mockResolvedValue({ messageId: 'provider-message-1' });
    vi.mocked(bootstrapDb.userOrganization.findMany).mockResolvedValue([
      { organizationId: 'org-2' },
      { organizationId: 'org-1' },
    ] as never);

    const response = await POST(req(), ctx);

    expect(response.status).toBe(200);
    expect(mockInvalidateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'acs', providerOperationId: expect.any(String) }),
      })
    );
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^password-reset-.*-accepted-org-1$/),
        metadata: expect.objectContaining({
          outcome: 'accepted',
          stage: 'provider_submission',
          provider: 'acs',
          providerMessageId: 'provider-message-1',
        }),
      })
    );
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        organizationId: 'org-2',
        idempotencyKey: expect.stringMatching(/^password-reset-.*-accepted-org-2$/),
        metadata: expect.objectContaining({ auditScopeSource: 'captured_snapshot' }),
      })
    );
  });

  it('queues a legacy reset with the full deterministic captured audit scope', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
    mockHasCapability.mockImplementation((cap) => cap === 'canSendAsyncEmail');
    vi.mocked(bootstrapDb.userOrganization.findMany).mockResolvedValue([
      { organizationId: 'org-2' },
      { organizationId: 'org-1' },
      { organizationId: 'org-2' },
    ] as never);
    const tx = resetTx();
    useTx(tx);

    const response = await POST(req(), ctx);

    expect(response.status).toBe(200);
    expect(mockAddJob).toHaveBeenCalledWith(
      'normal',
      'email.send',
      expect.objectContaining({
        passwordReset: expect.objectContaining({ organizationIds: ['org-1', 'org-2'] }),
      }),
      expect.any(Object)
    );
  });

  it('mints a token, audits it, and queues only the reset flow reference', async () => {
    const tx = resetTx();
    useTx(tx);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);

    // A per-target row lock is taken before the cooldown check (atomic cooldown).
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        userId: 'user-2',
        token: expect.stringMatching(/^prh1:[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
        requestId: 'req-admin-reset',
        organizationId: 'org-1',
      }),
    });
    // Audit records the request but NEVER the token itself (metadata + text).
    const createArg = (tx.passwordResetToken.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const mintedToken = createArg?.data?.token as string;
    expect(mintedToken).toEqual(expect.any(String));
    expect(JSON.stringify(mockCreateSecurityAuditEvent.mock.calls)).not.toContain(mintedToken);
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        actorType: 'ADMIN',
        correlationId: createArg?.data?.id,
        metadata: expect.objectContaining({ targetUserId: 'user-2' }),
      })
    );
    expect(mockAddJob).toHaveBeenCalledWith(
      'normal',
      'password-reset.deliver',
      { schemaVersion: 1, flowId: expect.any(String), deliveryAttempt: 1 },
      expect.objectContaining({
        attempts: 1,
        jobId: expect.stringMatching(/^password-reset-.*-delivery-1$/),
      })
    );
    expect(tx.passwordResetRecovery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowId: createArg?.data?.id,
        keyId: 'test-key',
        ciphertext: expect.any(Buffer),
      }),
    });
    expect(JSON.stringify(mockAddJob.mock.calls)).not.toContain('prt1_');
  });

  it('does not regress a flow advanced by a fast worker back to QUEUED', async () => {
    const tx = resetTx();
    useTx(tx);
    mockInvalidateToken
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect(mockInvalidateToken).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({ deliveryStatus: 'PENDING' }),
      data: expect.objectContaining({ deliveryStatus: 'QUEUED', queueJobId: 'job-1' }),
    });
    expect(mockInvalidateToken).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({ queueJobId: null }),
      data: { queueJobId: 'job-1' },
    });
  });

  it('supersedes older links under the shared user lock before minting a new one', async () => {
    const tx = resetTx();
    useTx(tx);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-2', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.passwordResetToken.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.passwordResetToken.create.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  it('audits account-global admin issuance and supersession in every affected organization', async () => {
    const tx = resetTx();
    tx.passwordResetToken.findMany.mockResolvedValue([
      { id: 'old-flow', requestId: 'old-request' },
    ]);
    vi.mocked(bootstrapDb.userOrganization.findMany).mockResolvedValue([
      { organizationId: 'org-1' },
      { organizationId: 'org-2' },
    ] as never);
    useTx(tx);

    const response = await POST(req(), ctx);

    expect(response.status).toBe(200);
    expect(tx.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ auditOrganizationIds: ['org-1', 'org-2'] }),
    });
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        organizationId: 'org-2',
        idempotencyKey: expect.stringMatching(/^password-reset-.*-requested-org-2$/),
        metadata: expect.objectContaining({
          stage: 'request',
          initiatingOrganizationId: 'org-1',
        }),
      })
    );
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        organizationId: 'org-2',
        requestId: 'old-request',
        correlationId: 'old-flow',
        idempotencyKey: 'password-reset-old-flow-superseded-org-2',
        metadata: expect.objectContaining({
          outcome: 'cancelled',
          stage: 'request_supersession',
          errorCode: 'SUPERSEDED',
          initiatingOrganizationId: 'org-1',
        }),
      })
    );
  });

  it('does not synchronously send a flow superseded before the send claim', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
    const tx = resetTx();
    useTx(tx);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendSyncEmail');
    mockInvalidateToken.mockResolvedValue({ count: 0 } as never);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(409);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockInvalidateToken).toHaveBeenCalledWith({
      where: expect.objectContaining({
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
        deliveryStatus: 'PENDING',
      }),
      data: expect.objectContaining({ deliveryStatus: 'SENDING' }),
    });
  });

  it('delivers only to the post-lock account email', async () => {
    const tx = resetTx();
    tx.userOrganization.findFirst
      .mockResolvedValueOnce({
        id: 'uo-2',
        userId: 'user-2',
        organizationId: 'org-1',
        isActive: true,
        user: {
          id: 'user-2',
          email: 'old-address@example.com',
          firstName: 'Existing',
          isActive: true,
        },
        organization: { isActive: true },
      })
      .mockResolvedValueOnce({
        id: 'uo-2',
        userId: 'user-2',
        organizationId: 'org-1',
        isActive: true,
        user: {
          id: 'user-2',
          email: 'new-address@example.com',
          firstName: 'Existing',
          isActive: true,
        },
        organization: { isActive: true },
      });
    useTx(tx);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    const resetData = (tx.passwordResetToken.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      ?.data;
    const recoveryData = (tx.passwordResetRecovery.create as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0]?.data;
    const envelope = {
      cipherVersion: recoveryData.cipherVersion,
      keyId: recoveryData.keyId,
      nonce: recoveryData.nonce,
      ciphertext: recoveryData.ciphertext,
      authTag: recoveryData.authTag,
    };
    const context = {
      flowId: resetData.id,
      userId: resetData.userId,
      storedToken: resetData.token,
      expiresAt: resetData.expiresAt,
    };
    expect(() =>
      decryptPasswordResetRecoveryToken(
        envelope,
        'new-address@example.com',
        recoveryData.recipientFingerprint,
        context
      )
    ).not.toThrow();
    expect(() =>
      decryptPasswordResetRecoveryToken(
        envelope,
        'old-address@example.com',
        recoveryData.recipientFingerprint,
        context
      )
    ).toThrow();
  });

  it('does not mint when the account is deactivated before the locked re-read', async () => {
    const tx = resetTx();
    tx.userOrganization.findFirst
      .mockResolvedValueOnce({
        id: 'uo-2',
        userId: 'user-2',
        organizationId: 'org-1',
        isActive: true,
        user: {
          id: 'user-2',
          email: 'user@example.com',
          firstName: 'Existing',
          isActive: true,
        },
        organization: { isActive: true },
      })
      .mockResolvedValueOnce({
        id: 'uo-2',
        userId: 'user-2',
        organizationId: 'org-1',
        isActive: true,
        user: {
          id: 'user-2',
          email: 'user@example.com',
          firstName: 'Existing',
          isActive: false,
        },
        organization: { isActive: true },
      });
    useTx(tx);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(400);
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('does not log or audit the public token, reset URL, or secret on queue failure', async () => {
    const tx = resetTx();
    useTx(tx);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAddJob.mockImplementation(async () => {
      throw new Error('queue rejected test-session-secret');
    });

    await POST(req(), ctx);

    const emitted = JSON.stringify({
      logs: [consoleLog.mock.calls, consoleWarn.mock.calls, consoleError.mock.calls],
      requestAudit: mockCreateSecurityAuditEvent.mock.calls,
      failureAudit: mockCaptureSecurityAudit.mock.calls,
      lifecycleWrites: mockInvalidateToken.mock.calls,
    });
    expect(emitted).not.toContain('prt1_');
    expect(JSON.stringify(mockAddJob.mock.calls)).not.toContain('resetUrl');
    expect(emitted).not.toContain('test-session-secret');
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
