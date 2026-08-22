import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { RateLimitError } from '@/lib/errors';

const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockTransactionQueryRaw = vi.fn();
const mockWithOrgContext = vi.fn();
const mockCreateMfaVerifiedSession = vi.fn();
const mockCaptureAccessAudit = vi.fn();
const mockLoginByEmail = vi.fn().mockResolvedValue(undefined);
const mockLoginByIp = vi.fn().mockResolvedValue(undefined);
const mockSetSessionCookie = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    $transaction: vi.fn(),
  },
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/auth', () => ({
  createMfaVerifiedSession: (...args: unknown[]) => mockCreateMfaVerifiedSession(...args),
}));

vi.mock('@/lib/auth/twoFactorChallengeRepository', () => ({
  resolveTenantTwoFactorChallenge: vi.fn(() => ({ userId: 'user-1', organizationId: 'org-1' })),
}));

vi.mock('@/lib/totp', () => ({
  hashBackupCode: vi.fn(() => 'backup-code-hash'),
  verifyTOTP: vi.fn(() => true),
  verifyBackupCode: vi.fn(() => -1),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-2fa',
    ipAddress: '203.0.113.20',
    userAgent: '2fa-context-agent',
  })),
  setSessionCookie: (...args: unknown[]) => mockSetSessionCookie(...args),
  rateLimiters: {
    loginByEmail: (...args: unknown[]) => mockLoginByEmail(...args),
    loginByIp: (...args: unknown[]) => mockLoginByIp(...args),
  },
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
}));

import { POST } from './route';

describe('POST /api/auth/2fa/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted-test-secret',
      twoFactorBackupCodes: [],
      organizations: [
        {
          role: 'ADMIN',
          organization: { id: 'org-1', name: 'Org', slug: 'org', isActive: true },
        },
      ],
    });
    mockUserUpdate.mockResolvedValue({});
    mockTransactionQueryRaw.mockResolvedValue([{ twoFactorBackupCodes: ['backup-code-hash'] }]);
    mockWithOrgContext.mockImplementation(
      async (_organizationId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: {
            update: (...args: unknown[]) => mockUserUpdate(...args),
          },
          $queryRaw: (...args: unknown[]) => mockTransactionQueryRaw(...args),
        })
    );
    mockCreateMfaVerifiedSession.mockResolvedValue({
      session: { id: 'auth-session-1' },
      token: 't'.repeat(43),
    });
    mockCaptureAccessAudit.mockResolvedValue('disabled');
    mockSetSessionCookie.mockResolvedValue(undefined);
    mockLoginByEmail.mockResolvedValue(undefined);
    mockLoginByIp.mockResolvedValue(undefined);
  });

  it('uses identical normalized request metadata for the session and login audit', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/auth/2fa/validate', {
        method: 'POST',
        body: JSON.stringify({ code: '123456', tempToken: 'temporary-token' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockCreateMfaVerifiedSession).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      expect.objectContaining({
        ipAddress: '203.0.113.20',
        userAgent: '2fa-context-agent',
        mfaChallengeToken: 'temporary-token',
        expiresAt: expect.any(Date),
      }),
      expect.anything()
    );
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          organizations: expect.objectContaining({
            where: { isActive: true, organizationId: 'org-1' },
          }),
        }),
      })
    );
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-2fa',
        ipAddress: '203.0.113.20',
        userAgent: '2fa-context-agent',
      })
    );
  });

  it('returns 429 without validating the code when the 2FA rate limit is exceeded', async () => {
    mockLoginByEmail.mockRejectedValueOnce(new RateLimitError(60));

    const response = await POST(
      new NextRequest('http://localhost/api/auth/2fa/validate', {
        method: 'POST',
        body: JSON.stringify({ code: '123456', tempToken: 'temporary-token' }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toMatch(/too many/i);
    // Throttling happens after temp-token verification but before code checks.
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockCreateMfaVerifiedSession).not.toHaveBeenCalled();
  });

  it('does not consume a backup code or set a cookie when MFA session issuance fails', async () => {
    mockCreateMfaVerifiedSession.mockRejectedValueOnce(new Error('constrained issue denied'));

    const response = await POST(
      new NextRequest('http://localhost/api/auth/2fa/validate', {
        method: 'POST',
        body: JSON.stringify({ code: '123456', tempToken: 'temporary-token' }),
      })
    );

    expect(response.status).toBe(500);
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockSetSessionCookie).not.toHaveBeenCalled();
  });

  it('conditionally consumes a backup code inside the MFA-session transaction', async () => {
    const { verifyTOTP, verifyBackupCode } = await import('@/lib/totp');
    vi.mocked(verifyTOTP).mockReturnValueOnce(false);
    vi.mocked(verifyBackupCode).mockReturnValueOnce(0).mockReturnValueOnce(0);
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted-test-secret',
      twoFactorBackupCodes: ['backup-code-hash'],
      organizations: [
        {
          role: 'ADMIN',
          organization: { id: 'org-1', name: 'Org', slug: 'org', isActive: true },
        },
      ],
    });

    const response = await POST(
      new NextRequest('http://localhost/api/auth/2fa/validate', {
        method: 'POST',
        body: JSON.stringify({ code: 'backup-code', tempToken: 'temporary-token' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { twoFactorBackupCodes: [] },
    });
  });

  it('rolls back and withholds the cookie when a concurrent backup-code consume loses', async () => {
    const { verifyTOTP, verifyBackupCode } = await import('@/lib/totp');
    vi.mocked(verifyTOTP).mockReturnValueOnce(false);
    vi.mocked(verifyBackupCode).mockReturnValueOnce(0).mockReturnValueOnce(-1);
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted-test-secret',
      twoFactorBackupCodes: ['backup-code-hash'],
      organizations: [
        {
          role: 'ADMIN',
          organization: { id: 'org-1', name: 'Org', slug: 'org', isActive: true },
        },
      ],
    });
    mockTransactionQueryRaw.mockResolvedValueOnce([{ twoFactorBackupCodes: [] }]);

    const response = await POST(
      new NextRequest('http://localhost/api/auth/2fa/validate', {
        method: 'POST',
        body: JSON.stringify({ code: 'backup-code', tempToken: 'temporary-token' }),
      })
    );

    expect(response.status).toBe(500);
    expect(mockSetSessionCookie).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
