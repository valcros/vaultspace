import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  createToken: vi.fn(),
  supersedeTokens: vi.fn(),
  lockUser: vi.fn(),
  findLockedUser: vi.fn(),
  updateToken: vi.fn(),
  transaction: vi.fn(),
  addJob: vi.fn(),
  sendEmail: vi.fn(),
  hasCapability: vi.fn(),
  createSecurityAuditEvent: vi.fn(),
  captureSecurityAudit: vi.fn(),
  resetByEmail: vi.fn(),
  resetByIp: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  bootstrapDb: {
    user: {
      findUnique: mocks.findUser,
    },
    passwordResetToken: {
      create: mocks.createToken,
      updateMany: mocks.updateToken,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/audit/securityAudit', () => ({
  createSecurityAuditEvent: (...args: unknown[]) => mocks.createSecurityAuditEvent(...args),
  captureSecurityAudit: (...args: unknown[]) => mocks.captureSecurityAudit(...args),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-forgot',
    ipAddress: '192.0.2.10',
    userAgent: 'forgot-test-agent',
    customDomain: { orgSlug: 'demo', customHost: 'demo.vaultspace.example.com' },
  })),
  rateLimiters: {
    passwordResetByEmailFingerprint: (...args: unknown[]) => mocks.resetByEmail(...args),
    passwordResetByIp: (...args: unknown[]) => mocks.resetByIp(...args),
  },
}));

vi.mock('@/providers', () => ({
  getProviders: () => ({
    job: {
      addJob: mocks.addJob,
    },
    email: {
      sendEmail: mocks.sendEmail,
    },
  }),
}));

vi.mock('@/lib/deployment-capabilities', () => ({
  hasCapability: mocks.hasCapability,
}));

import { POST } from './route';

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['APP_URL'] = 'https://vaultspace.example.com';
    process.env['SESSION_SECRET'] = 'test-session-secret';
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    mocks.findUser.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      firstName: 'Ada',
      isActive: true,
      organizations: [
        {
          role: 'ADMIN',
          organization: {
            id: 'org-1',
            name: 'Demo Organization',
            slug: 'demo',
            emailSenderName: null,
            emailSenderAddress: null,
          },
        },
      ],
    });
    mocks.findLockedUser.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      firstName: 'Ada',
      isActive: true,
      organizations: [
        {
          role: 'ADMIN',
          organization: {
            id: 'org-1',
            name: 'Demo Organization',
            slug: 'demo',
            emailSenderName: null,
            emailSenderAddress: null,
          },
        },
      ],
    });
    mocks.createToken.mockResolvedValue({ id: 'reset-token-1' });
    mocks.supersedeTokens.mockResolvedValue({ count: 0 });
    mocks.lockUser.mockResolvedValue([]);
    mocks.updateToken.mockResolvedValue({ count: 1 });
    mocks.createSecurityAuditEvent.mockResolvedValue('event-1');
    mocks.captureSecurityAudit.mockResolvedValue('captured');
    mocks.resetByEmail.mockResolvedValue(undefined);
    mocks.resetByIp.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        passwordResetToken: {
          create: mocks.createToken,
          updateMany: mocks.supersedeTokens,
        },
        user: { findUnique: mocks.findLockedUser },
        $queryRaw: mocks.lockUser,
      })
    );
    mocks.addJob.mockResolvedValue('job-1');
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendAsyncEmail'
    );
  });

  it('queues the supported email.send job for async password reset email', async () => {
    const request = new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'Admin@Example.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    expect(mocks.addJob).toHaveBeenCalledWith(
      'normal',
      'email.send',
      expect.objectContaining({
        to: 'admin@example.com',
        subject: 'Reset your Demo Organization password',
        template: 'password-reset',
        data: expect.objectContaining({
          userName: 'Ada',
          organizationName: 'Demo Organization',
          resetUrl: expect.stringContaining(
            'https://vaultspace.example.com/auth/reset-password#token='
          ),
          expiresIn: '1 hour',
        }),
        passwordReset: expect.objectContaining({
          userId: 'user-1',
          requestId: 'req-forgot',
          organizationIds: ['org-1'],
        }),
      }),
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
        jobId: expect.stringMatching(/^password-reset-/),
      })
    );
    expect(mocks.createSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        requestId: 'req-forgot',
      })
    );
    const storedToken = mocks.createToken.mock.calls[0]?.[0]?.data?.token as string;
    const queuedUrl = mocks.addJob.mock.calls[0]?.[2]?.data?.resetUrl as string;
    const queuedUrlObject = new URL(queuedUrl);
    const publicToken = new URLSearchParams(queuedUrlObject.hash.slice(1)).get('token');
    expect(queuedUrlObject.search).toBe('');
    expect(storedToken).toMatch(/^prh1:[a-f0-9]{64}$/);
    expect(publicToken).toMatch(/^prt1_[A-Za-z0-9_-]{43}$/);
    expect(storedToken).not.toContain(publicToken ?? 'missing');
  });

  it('keeps the public response neutral when queue insertion fails', async () => {
    mocks.addJob.mockRejectedValue(new Error('redis unavailable'));

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.updateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'QUEUE_FAILED' }),
      })
    );
    expect(mocks.captureSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        metadata: expect.objectContaining({ stage: 'queue', errorCode: 'EMAIL_QUEUE_ERROR' }),
      })
    );
  });

  it('does not regress a flow advanced by a fast worker back to QUEUED', async () => {
    mocks.updateToken.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.updateToken).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({ deliveryStatus: 'PENDING' }),
      data: expect.objectContaining({ deliveryStatus: 'QUEUED', queueJobId: 'job-1' }),
    });
    expect(mocks.updateToken).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({ queueJobId: null }),
      data: { queueJobId: 'job-1' },
    });
  });

  it('audits a synchronous provider rejection while keeping the response neutral', async () => {
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendSyncEmail'
    );
    mocks.sendEmail.mockRejectedValue(
      Object.assign(new Error('mailbox rejected'), { status: 400 })
    );

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.captureSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        metadata: expect.objectContaining({ stage: 'provider_submission' }),
      })
    );
  });

  it('does not report provider failure when lifecycle persistence fails after acceptance', async () => {
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendSyncEmail'
    );
    mocks.sendEmail.mockResolvedValue({ messageId: 'provider-message-1' });
    mocks.updateToken
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('database unavailable after acceptance'));

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.captureSecurityAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'USER_PASSWORD_RESET' })
    );
    expect(mocks.updateToken).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: expect.stringMatching(/^FAILED_/),
        }),
      })
    );
  });

  it('audits missing email capability while keeping the response neutral', async () => {
    mocks.hasCapability.mockReturnValue(false);

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.captureSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        metadata: expect.objectContaining({
          stage: 'configuration',
          errorCode: 'EMAIL_NOT_CONFIGURED',
        }),
      })
    );
  });

  it('returns the same public response for an unknown account', async () => {
    mocks.findUser.mockResolvedValue(null);

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'unknown@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.addJob).not.toHaveBeenCalled();
  });

  it('fails before account lookup or token mutation when the reset secret is missing', async () => {
    delete process.env['SESSION_SECRET'];

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(500);
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.addJob).not.toHaveBeenCalled();
  });

  it('fails before account lookup when the write mode is invalid', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'HMAC';

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(500);
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns the same neutral response without minting a token for an orphan account', async () => {
    mocks.findUser.mockResolvedValue({
      id: 'user-orphan',
      email: 'orphan@example.com',
      firstName: 'Orphan',
      isActive: true,
      organizations: [],
    });

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'orphan@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.addJob).not.toHaveBeenCalled();
  });

  it('serializes issuance and supersedes older links before minting a new one', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.lockUser).toHaveBeenCalledTimes(2);
    expect(mocks.supersedeTokens).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(mocks.supersedeTokens.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createToken.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  it('does not synchronously send a flow superseded before the send claim', async () => {
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendSyncEmail'
    );
    mocks.updateToken.mockResolvedValue({ count: 0 });

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.updateToken).toHaveBeenCalledWith({
      where: expect.objectContaining({
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
        deliveryStatus: 'PENDING',
      }),
      data: expect.objectContaining({ deliveryStatus: 'SENDING' }),
    });
  });

  it('does not mint or send when the login email changes before the locked re-read', async () => {
    mocks.findLockedUser.mockResolvedValue({
      id: 'user-1',
      email: 'new-address@example.com',
      firstName: 'Ada',
      isActive: true,
      organizations: [
        {
          role: 'ADMIN',
          organization: {
            id: 'org-1',
            name: 'Demo Organization',
            slug: 'demo',
            emailSenderName: null,
            emailSenderAddress: null,
          },
        },
      ],
    });

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.addJob).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('does not log or audit the public token, reset URL, or secret on queue failure', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resetUrl = '';
    mocks.addJob.mockImplementation(async (_queue, _name, data) => {
      resetUrl = data.data.resetUrl;
      throw new Error(`queue rejected ${resetUrl} test-session-secret`);
    });

    await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    const publicToken = new URLSearchParams(new URL(resetUrl).hash.slice(1)).get('token') ?? '';
    const emitted = JSON.stringify({
      logs: [consoleLog.mock.calls, consoleWarn.mock.calls, consoleError.mock.calls],
      requestAudit: mocks.createSecurityAuditEvent.mock.calls,
      failureAudit: mocks.captureSecurityAudit.mock.calls,
      lifecycleWrites: mocks.updateToken.mock.calls,
    });
    expect(emitted).not.toContain(publicToken);
    expect(emitted).not.toContain(resetUrl);
    expect(emitted).not.toContain('test-session-secret');
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
