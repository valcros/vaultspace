import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockHash = vi.fn();
const mockCandidateProven = vi.fn();
const mockRedeem = vi.fn();
const mockRepositoryConstructor = vi.fn();
const mockTransaction = vi.fn();
const mockSetBootstrapContext = vi.fn();
const mockSetTransactionOrganizationContext = vi.fn();
const mockClearSessionCache = vi.fn();
const mockCreateSecurityAuditEvent = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: Parameters<typeof mockHash>) => mockHash(...args),
  },
}));

vi.mock('@/lib/auth', () => ({
  clearSessionCache: (...args: Parameters<typeof mockClearSessionCache>) =>
    mockClearSessionCache(...args),
}));

vi.mock('@/lib/auth/passwordResetCapabilityRepository', () => ({
  passwordResetCapabilityRepository: {
    candidateProven: (...args: Parameters<typeof mockCandidateProven>) =>
      mockCandidateProven(...args),
  },
  PasswordResetCapabilityRepository: class MockPasswordResetCapabilityRepository {
    constructor(client: unknown) {
      mockRepositoryConstructor(client);
    }

    redeem(...args: Parameters<typeof mockRedeem>) {
      return mockRedeem(...args);
    }
  },
}));

vi.mock('@/lib/audit/securityAudit', () => ({
  createSecurityAuditEvent: (...args: Parameters<typeof mockCreateSecurityAuditEvent>) =>
    mockCreateSecurityAuditEvent(...args),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-reset',
    ipAddress: '192.0.2.20',
    userAgent: 'reset-test-agent',
  })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: (...args: Parameters<typeof mockTransaction>) => mockTransaction(...args),
  },
  setBootstrapContext: (...args: Parameters<typeof mockSetBootstrapContext>) =>
    mockSetBootstrapContext(...args),
  setTransactionOrganizationContext: (
    ...args: Parameters<typeof mockSetTransactionOrganizationContext>
  ) => mockSetTransactionOrganizationContext(...args),
}));

import { POST } from './route';
import { createPasswordResetToken } from '@/lib/auth/passwordResetToken';

const LEGACY_TOKEN = 'A'.repeat(43);
const INVALID_RESET_RESPONSE = { error: 'Invalid or expired password reset token' };
const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn() };
const redemption = {
  flowId: 'flow-1',
  subjectUserId: 'user-1',
  subjectEmail: 'user@example.test',
  initiationRequestId: 'request-forgot-1',
  auditOrganizations: [
    { organizationId: 'org-1', actorType: 'ADMIN' },
    { organizationId: 'org-2', actorType: 'VIEWER' },
  ],
  supersededFlows: [
    { flowId: 'flow-2', requestId: 'request-forgot-2' },
    { flowId: 'flow-3', requestId: null },
  ],
  revokedSessionIds: ['session-1', 'session-2'],
};

function resetRequest(token = LEGACY_TOKEN, password = 'password123') {
  return new NextRequest('http://localhost/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['SESSION_SECRET'] = 'test-session-secret';
    delete process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'];

    mockCandidateProven.mockResolvedValue(true);
    mockHash.mockResolvedValue(`$2b$12$${'A'.repeat(53)}`);
    mockRedeem.mockResolvedValue(redemption);
    mockSetBootstrapContext.mockResolvedValue(undefined);
    mockSetTransactionOrganizationContext.mockResolvedValue(undefined);
    mockCreateSecurityAuditEvent.mockResolvedValue('event-1');
    mockClearSessionCache.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(async (callback) => callback(tx));
  });

  it('proves the candidate before bcrypt and composes redemption plus audits atomically', async () => {
    const response = await POST(resetRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockCandidateProven).toHaveBeenCalledWith(LEGACY_TOKEN);
    expect(mockCandidateProven.mock.invocationCallOrder[0]).toBeLessThan(
      mockHash.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
    expect(mockHash).toHaveBeenCalledWith('password123', 12);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 30_000,
    });
    expect(mockSetBootstrapContext).toHaveBeenCalledWith(tx);
    expect(mockRepositoryConstructor).toHaveBeenCalledWith(tx);
    expect(mockRedeem).toHaveBeenCalledWith(LEGACY_TOKEN, `$2b$12$${'A'.repeat(53)}`);
    expect(mockSetTransactionOrganizationContext.mock.calls).toEqual([
      [tx, 'org-1'],
      [tx, 'org-2'],
    ]);
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledTimes(6);
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org-1',
        correlationId: 'flow-1',
        idempotencyKey: 'password-reset-flow-1-completed-org-1',
        metadata: expect.objectContaining({
          outcome: 'success',
          stage: 'completed',
          invalidatedSessionCount: 2,
        }),
      })
    );
    expect(mockCreateSecurityAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org-2',
        correlationId: 'flow-3',
        requestId: 'recovery-flow-3',
        idempotencyKey: 'password-reset-flow-3-superseded-org-2',
      })
    );
    expect(mockClearSessionCache).toHaveBeenCalledWith(['session-1', 'session-2']);
    expect(mockClearSessionCache.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockTransaction.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('uses the non-reversible HMAC lookup and never passes the public token to PostgreSQL', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    const pair = createPasswordResetToken();

    const response = await POST(resetRequest(pair.publicToken));

    expect(response.status).toBe(200);
    expect(mockCandidateProven).toHaveBeenCalledWith(pair.storedToken);
    expect(mockRedeem).toHaveBeenCalledWith(pair.storedToken, expect.any(String));
    expect(JSON.stringify(mockCandidateProven.mock.calls)).not.toContain(pair.publicToken);
    expect(JSON.stringify(mockRedeem.mock.calls)).not.toContain(pair.publicToken);
  });

  it('returns one neutral response for malformed, candidate-denied, and redemption-race tokens', async () => {
    const malformed = await POST(resetRequest('malformed'));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual(INVALID_RESET_RESPONSE);
    expect(mockCandidateProven).not.toHaveBeenCalled();
    expect(mockHash).not.toHaveBeenCalled();

    mockCandidateProven.mockResolvedValueOnce(false);
    const denied = await POST(resetRequest());
    expect(denied.status).toBe(400);
    await expect(denied.json()).resolves.toEqual(INVALID_RESET_RESPONSE);
    expect(mockHash).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();

    mockRedeem.mockResolvedValueOnce(null);
    const raced = await POST(resetRequest());
    expect(raced.status).toBe(400);
    await expect(raced.json()).resolves.toEqual(INVALID_RESET_RESPONSE);
    expect(mockCreateSecurityAuditEvent).not.toHaveBeenCalled();
    expect(mockClearSessionCache).not.toHaveBeenCalled();
  });

  it('rejects a stored digest replay before candidate lookup or bcrypt work', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    const pair = createPasswordResetToken();

    const response = await POST(resetRequest(pair.storedToken));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(INVALID_RESET_RESPONSE);
    expect(mockCandidateProven).not.toHaveBeenCalled();
    expect(mockHash).not.toHaveBeenCalled();
  });

  it('fails closed before lookup when SESSION_SECRET is absent', async () => {
    delete process.env['SESSION_SECRET'];

    const response = await POST(resetRequest());

    expect(response.status).toBe(500);
    expect(mockCandidateProven).not.toHaveBeenCalled();
    expect(mockHash).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rolls the capability mutation back when an audit insert fails', async () => {
    mockCreateSecurityAuditEvent.mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await POST(resetRequest());

    expect(response.status).toBe(500);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockClearSessionCache).not.toHaveBeenCalled();
  });

  it('keeps a committed reset successful when best-effort cache eviction fails', async () => {
    mockClearSessionCache.mockRejectedValueOnce(new Error('redis unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(resetRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    const emitted = JSON.stringify(consoleError.mock.calls);
    expect(emitted).toContain('revoked_session_cache_delete');
    expect(emitted).toContain('requestedCount');
    expect(emitted).not.toContain('session-1');
    expect(emitted).not.toContain('session-2');
    consoleError.mockRestore();
  });

  it('never logs the public token, stored digest, or reset secret on repository failure', async () => {
    process.env['PASSWORD_RESET_TOKEN_WRITE_MODE'] = 'hmac';
    const pair = createPasswordResetToken();
    mockCandidateProven.mockRejectedValueOnce(
      new Error(`lookup rejected ${pair.publicToken} ${pair.storedToken} test-session-secret`)
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(resetRequest(pair.publicToken));

    expect(response.status).toBe(500);
    const emitted = JSON.stringify(consoleError.mock.calls);
    expect(emitted).not.toContain(pair.publicToken);
    expect(emitted).not.toContain(pair.storedToken);
    expect(emitted).not.toContain('test-session-secret');
    consoleError.mockRestore();
  });

  it('keeps password validation specific while token validation remains neutral', async () => {
    const badToken = await POST(resetRequest(''));
    expect(badToken.status).toBe(400);
    await expect(badToken.json()).resolves.toEqual(INVALID_RESET_RESPONSE);

    const badPassword = await POST(resetRequest(LEGACY_TOKEN, 'short'));
    expect(badPassword.status).toBe(400);
    await expect(badPassword.json()).resolves.toEqual({
      error: 'Password must be at least 8 characters',
    });
  });
});
