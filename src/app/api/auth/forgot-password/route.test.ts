import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  createToken: vi.fn(),
  findSupersededFlows: vi.fn(),
  supersedeTokens: vi.fn(),
  lockUser: vi.fn(),
  advisoryLockUser: vi.fn(),
  findLockedUser: vi.fn(),
  updateToken: vi.fn(),
  findTokenState: vi.fn(),
  updateTokenState: vi.fn(),
  createRecovery: vi.fn(),
  updateRecovery: vi.fn(),
  findRecoveryState: vi.fn(),
  updateRecoveryState: vi.fn(),
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
      findMany: mocks.findSupersededFlows,
      updateMany: mocks.updateToken,
    },
    passwordResetRecovery: {
      create: mocks.createRecovery,
      updateMany: mocks.updateRecovery,
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
  getConfiguredEmailProviderName: () => 'acs',
  getProviders: () => ({
    job: {
      addJob: mocks.addJob,
    },
    email: {
      providerName: 'acs',
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
    vi.resetAllMocks();
    process.env['APP_URL'] = 'https://vaultspace.example.com';
    process.env['SESSION_SECRET'] = 'test-session-secret';
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    process.env['PASSWORD_RESET_RECOVERY_ACTIVE_KEY_ID'] = 'test-key';
    process.env['PASSWORD_RESET_RECOVERY_KEYS'] = JSON.stringify({
      'test-key': Buffer.alloc(32, 7).toString('base64'),
    });
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
    mocks.findSupersededFlows.mockResolvedValue([]);
    mocks.supersedeTokens.mockResolvedValue({ count: 0 });
    mocks.lockUser.mockResolvedValue([]);
    mocks.advisoryLockUser.mockResolvedValue(1);
    mocks.updateToken.mockResolvedValue({ count: 1 });
    mocks.findTokenState.mockResolvedValue({
      deliveryStatus: 'PENDING',
      providerAcceptedAt: null,
    });
    mocks.updateTokenState.mockResolvedValue({});
    mocks.createRecovery.mockResolvedValue({ flowId: 'flow-1' });
    mocks.updateRecovery.mockResolvedValue({ count: 1 });
    mocks.findRecoveryState.mockResolvedValue({ enqueueStatus: 'PENDING', wipedAt: null });
    mocks.updateRecoveryState.mockResolvedValue({});
    mocks.createSecurityAuditEvent.mockResolvedValue('event-1');
    mocks.captureSecurityAudit.mockResolvedValue('captured');
    mocks.resetByEmail.mockResolvedValue(undefined);
    mocks.resetByIp.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        passwordResetToken: {
          create: mocks.createToken,
          findMany: mocks.findSupersededFlows,
          findUnique: mocks.findTokenState,
          update: mocks.updateTokenState,
          updateMany: mocks.supersedeTokens,
        },
        passwordResetRecovery: {
          create: mocks.createRecovery,
          findUnique: mocks.findRecoveryState,
          update: mocks.updateRecoveryState,
          updateMany: mocks.updateRecovery,
        },
        user: { findUnique: mocks.findLockedUser },
        $queryRaw: mocks.lockUser,
        $executeRaw: mocks.advisoryLockUser,
      })
    );
    mocks.addJob.mockResolvedValue('job-1');
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendAsyncEmail'
    );
  });

  it('queues a flow-only delivery job and keeps recovery material in PostgreSQL', async () => {
    const request = new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'Admin@Example.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    expect(mocks.addJob).toHaveBeenCalledWith(
      'normal',
      'password-reset.deliver',
      { schemaVersion: 1, flowId: expect.any(String), deliveryAttempt: 1 },
      expect.objectContaining({
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
        jobId: expect.stringMatching(/^password-reset-.*-delivery-1$/),
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
    expect(storedToken).toMatch(/^prh1:[a-f0-9]{64}$/);
    expect(mocks.createToken).toHaveBeenCalledWith({
      data: expect.objectContaining({
        auditOrganizationIds: ['org-1'],
        providerCorrelationSchemaVersion: 1,
      }),
    });
    expect(mocks.createRecovery).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowId: expect.any(String),
        keyId: 'test-key',
        nonce: expect.any(Buffer),
        ciphertext: expect.any(Buffer),
        authTag: expect.any(Buffer),
      }),
    });
    expect(JSON.stringify(mocks.addJob.mock.calls)).not.toContain('prt1_');
  });

  it('snapshots the same deterministic multi-organization scope used for request auditing', async () => {
    mocks.findLockedUser.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      firstName: 'Ada',
      isActive: true,
      organizations: [
        {
          role: 'MEMBER',
          organization: {
            id: 'org-2',
            name: 'Second Organization',
            slug: 'second',
            emailSenderName: null,
            emailSenderAddress: null,
          },
        },
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
    expect(mocks.createToken).toHaveBeenCalledWith({
      data: expect.objectContaining({ auditOrganizationIds: ['org-1', 'org-2'] }),
    });
    for (const organizationId of ['org-1', 'org-2']) {
      expect(mocks.createSecurityAuditEvent).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ organizationId, correlationId: expect.any(String) })
      );
    }
  });

  it('rejects an over-limit locked scope before supersession, token creation, or delivery', async () => {
    const organizations = Array.from({ length: 65 }, (_, index) => ({
      role: 'MEMBER',
      organization: {
        id: `org-${String(index).padStart(2, '0')}`,
        name: `Organization ${index}`,
        slug: `organization-${index}`,
        emailSenderName: null,
        emailSenderAddress: null,
      },
    }));
    mocks.findLockedUser.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      firstName: 'Ada',
      isActive: true,
      organizations,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.findSupersededFlows).not.toHaveBeenCalled();
    expect(mocks.supersedeTokens).not.toHaveBeenCalled();
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.createRecovery).not.toHaveBeenCalled();
    expect(mocks.addJob).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    const operationsLog = consoleError.mock.calls.find((call) =>
      String(call[0]).includes('audit_scope_validation')
    );
    expect(operationsLog).toBeDefined();
    expect(String(operationsLog?.[0])).toContain('PASSWORD_RESET_AUDIT_SCOPE_TOO_LARGE');
    expect(String(operationsLog?.[0])).toContain('65_PLUS');
    expect(String(operationsLog?.[0])).not.toContain('admin@example.com');
    expect(String(operationsLog?.[0])).not.toContain('user-1');
    expect(String(operationsLog?.[0])).not.toContain('org-00');
    consoleError.mockRestore();
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
    expect(mocks.updateTokenState).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'QUEUE_RETRYING' }),
      })
    );
    expect(mocks.createSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        metadata: expect.objectContaining({
          outcome: 'pending',
          stage: 'queue',
          errorCode: 'EMAIL_QUEUE_ERROR',
        }),
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
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
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
    expect(mocks.updateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'acs', providerOperationId: expect.any(String) }),
      })
    );
    expect(mocks.captureSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        metadata: expect.objectContaining({ stage: 'provider_submission' }),
      })
    );
  });

  it('does not report provider failure when lifecycle persistence fails after acceptance', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendSyncEmail'
    );
    mocks.sendEmail.mockResolvedValue({ messageId: 'provider-message-1' });
    const issuanceTransaction = mocks.transaction.getMockImplementation();
    mocks.transaction
      .mockImplementationOnce(issuanceTransaction!)
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

  it('records immutable provider acceptance for synchronous legacy delivery', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendSyncEmail'
    );
    mocks.sendEmail.mockResolvedValue({ messageId: 'provider-message-1' });

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.updateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'acs', providerOperationId: expect.any(String) }),
      })
    );
    expect(mocks.createSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventType: 'USER_PASSWORD_RESET',
        idempotencyKey: expect.stringMatching(/^password-reset-.*-accepted-org-1$/),
        metadata: expect.objectContaining({
          outcome: 'accepted',
          stage: 'provider_submission',
          provider: 'acs',
        }),
      })
    );
  });

  it('audits missing email capability while keeping the response neutral', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
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

  it('fails before account lookup when HMAC recovery keys are unavailable', async () => {
    delete process.env['PASSWORD_RESET_RECOVERY_KEYS'];

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(500);
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.createToken).not.toHaveBeenCalled();
  });

  it('fails before account lookup when HMAC delivery has no async worker', async () => {
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendSyncEmail'
    );

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(500);
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.createToken).not.toHaveBeenCalled();
  });

  it('returns the same neutral response without minting a token for an orphan account', async () => {
    mocks.findUser.mockResolvedValue({
      id: 'user-orphan',
      email: 'orphan@example.com',
      firstName: 'Orphan',
      isActive: true,
      organizations: [],
    });
    mocks.findLockedUser.mockResolvedValue({
      id: 'user-orphan',
      email: 'orphan@example.com',
      firstName: 'Orphan',
      isActive: true,
      organizations: [],
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'orphan@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.addJob).not.toHaveBeenCalled();
    const operationsLog = consoleError.mock.calls.find((call) =>
      String(call[0]).includes('audit_scope_validation')
    );
    expect(String(operationsLog?.[0])).toContain('PASSWORD_RESET_AUDIT_SCOPE_EMPTY');
    expect(String(operationsLog?.[0])).toContain('"auditScopeCardinalityBucket":"0"');
    expect(String(operationsLog?.[0])).not.toContain('orphan@example.com');
    expect(String(operationsLog?.[0])).not.toContain('user-orphan');
    consoleError.mockRestore();
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
    expect(mocks.advisoryLockUser).toHaveBeenCalledTimes(1);
    expect(mocks.supersedeTokens).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(mocks.supersedeTokens.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createToken.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  it('records immutable cancellation when a newer request supersedes a reset flow', async () => {
    mocks.findSupersededFlows.mockResolvedValue([{ id: 'old-flow', requestId: 'old-request' }]);

    const response = await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.createSecurityAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        correlationId: 'old-flow',
        idempotencyKey: 'password-reset-old-flow-superseded-org-1',
        metadata: expect.objectContaining({ errorCode: 'SUPERSEDED' }),
      })
    );
  });

  it('does not synchronously send a flow superseded before the send claim', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'legacy';
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
    mocks.addJob.mockImplementation(async () => {
      throw new Error('queue rejected test-session-secret');
    });

    await POST(
      new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );

    const emitted = JSON.stringify({
      logs: [consoleLog.mock.calls, consoleWarn.mock.calls, consoleError.mock.calls],
      requestAudit: mocks.createSecurityAuditEvent.mock.calls,
      failureAudit: mocks.captureSecurityAudit.mock.calls,
      lifecycleWrites: mocks.updateToken.mock.calls,
    });
    expect(emitted).not.toContain('prt1_');
    expect(JSON.stringify(mocks.addJob.mock.calls)).not.toContain('resetUrl');
    expect(emitted).not.toContain('test-session-secret');
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
