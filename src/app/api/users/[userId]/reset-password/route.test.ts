/**
 * Admin-triggered Password Reset API tests
 *
 * POST /api/users/:userId/reset-password
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
  getRequestContext: vi.fn(() => ({
    requestId: 'req-admin-reset',
    ipAddress: '192.0.2.30',
    userAgent: 'admin-reset-test-agent',
  })),
}));
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
  bootstrapDb: { passwordResetToken: { updateMany: vi.fn() } },
}));
vi.mock('@/providers', () => ({ getProviders: vi.fn() }));
vi.mock('@/lib/deployment-capabilities', () => ({ hasCapability: vi.fn() }));
const mockCreateSecurityAuditEvent = vi.fn();
const mockCaptureSecurityAudit = vi.fn();
vi.mock('@/lib/audit/securityAudit', () => ({
  createSecurityAuditEvent: (...args: unknown[]) => mockCreateSecurityAuditEvent(...args),
  captureSecurityAudit: (...args: unknown[]) => mockCaptureSecurityAudit(...args),
}));
vi.mock('@/workers/types', () => ({
  JOB_NAMES: { EMAIL_SEND: 'email.send' },
  QUEUE_NAMES: { NORMAL: 'normal' },
  PASSWORD_RESET_EMAIL_JOB_OPTIONS: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60_000 },
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

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['APP_URL'] = 'https://app.example.com';
    process.env['SESSION_SECRET'] = 'test-session-secret';
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    mockRequireAuth.mockResolvedValue(adminSession as Session);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendAsyncEmail');
    mockGetProviders.mockReturnValue({
      job: { addJob: mockAddJob },
      email: { sendEmail: mockSendEmail },
    } as unknown as ReturnType<typeof getProviders>);
    mockAddJob.mockResolvedValue('job-1');
    mockCreateSecurityAuditEvent.mockResolvedValue('event-1');
    mockCaptureSecurityAudit.mockResolvedValue('captured');
    mockInvalidateToken.mockResolvedValue({ count: 1 } as never);
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
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
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

  it('returns 404 when the target is not a member of the org', async () => {
    useTx({ userOrganization: { findFirst: vi.fn().mockResolvedValue(null) } });
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

  it('returns 502 and invalidates the undelivered token when the email cannot be queued', async () => {
    const tx = resetTx();
    useTx(tx);
    mockAddJob.mockRejectedValue(new Error('queue down'));
    mockInvalidateToken.mockResolvedValue({ count: 1 } as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(502);
    // The token was minted before delivery was attempted...
    expect(tx.passwordResetToken.create).toHaveBeenCalled();
    // ...then neutralized so it can't linger and doesn't block a retry.
    expect(mockInvalidateToken).toHaveBeenCalledWith({
      where: { id: expect.any(String), usedAt: null },
      data: expect.objectContaining({
        usedAt: expect.any(Date),
        deliveryStatus: 'QUEUE_FAILED',
      }),
    });
  });

  it('records retryable synchronous submission failure as exhausted', async () => {
    const tx = resetTx();
    useTx(tx);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendSyncEmail');
    mockSendEmail.mockRejectedValue({ statusCode: 503 });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(502);
    expect(mockInvalidateToken).toHaveBeenLastCalledWith({
      where: { id: expect.any(String), usedAt: null },
      data: expect.objectContaining({
        usedAt: expect.any(Date),
        deliveryStatus: 'FAILED_EXHAUSTED',
        deliveryErrorCode: 'EMAIL_PROVIDER_UNAVAILABLE',
      }),
    });
    expect(mockCaptureSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          stage: 'provider_submission',
          retryable: true,
        }),
      })
    );
  });

  it('records permanent synchronous submission rejection as permanent', async () => {
    const tx = resetTx();
    useTx(tx);
    mockHasCapability.mockImplementation((cap) => cap === 'canSendSyncEmail');
    mockSendEmail.mockRejectedValue({ statusCode: 400 });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(502);
    expect(mockInvalidateToken).toHaveBeenLastCalledWith({
      where: { id: expect.any(String), usedAt: null },
      data: expect.objectContaining({
        deliveryStatus: 'FAILED_PERMANENT',
        deliveryErrorCode: 'EMAIL_HTTP_400',
      }),
    });
  });

  it('keeps an accepted synchronous reset valid when lifecycle persistence fails', async () => {
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

  it('mints a token, audits USER_PASSWORD_RESET, and queues the email via the per-org sender', async () => {
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
      'email.send',
      expect.objectContaining({
        to: 'user@example.com',
        template: 'password-reset',
        from: 'dataroom@acme.example',
        fromName: 'Acme Data Room',
        data: expect.objectContaining({
          resetUrl: expect.stringContaining('/auth/reset-password#token='),
        }),
      }),
      expect.objectContaining({
        attempts: 5,
        jobId: expect.stringMatching(/^password-reset-/),
      })
    );
    const queuedUrl = mockAddJob.mock.calls[0]?.[2]?.data?.resetUrl as string;
    const queuedUrlObject = new URL(queuedUrl);
    const publicToken = new URLSearchParams(queuedUrlObject.hash.slice(1)).get('token');
    expect(queuedUrlObject.search).toBe('');
    expect(publicToken).toMatch(/^prt1_[A-Za-z0-9_-]{43}$/);
    expect(publicToken).not.toBe(mintedToken);
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

  it('does not synchronously send a flow superseded before the send claim', async () => {
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
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ to: 'new-address@example.com' }),
      expect.any(Object)
    );
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
    let resetUrl = '';
    mockAddJob.mockImplementation(async (_queue, _name, data) => {
      resetUrl = data.data.resetUrl;
      throw new Error(`queue rejected ${resetUrl} test-session-secret`);
    });

    await POST(req(), ctx);

    const publicToken = new URLSearchParams(new URL(resetUrl).hash.slice(1)).get('token') ?? '';
    const emitted = JSON.stringify({
      logs: [consoleLog.mock.calls, consoleWarn.mock.calls, consoleError.mock.calls],
      requestAudit: mockCreateSecurityAuditEvent.mock.calls,
      failureAudit: mockCaptureSecurityAudit.mock.calls,
      lifecycleWrites: mockInvalidateToken.mock.calls,
    });
    expect(emitted).not.toContain(publicToken);
    expect(emitted).not.toContain(resetUrl);
    expect(emitted).not.toContain('test-session-secret');
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
