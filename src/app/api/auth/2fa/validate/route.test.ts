import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { RateLimitError } from '@/lib/errors';

const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockSessionCreate = vi.fn();
const mockCaptureAccessAudit = vi.fn();
const mockLoginByEmail = vi.fn().mockResolvedValue(undefined);
const mockLoginByIp = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    session: { create: (...args: unknown[]) => mockSessionCreate(...args) },
  },
}));

vi.mock('@/lib/auth/twoFactorTempToken', () => ({
  verifyTwoFactorTempToken: vi.fn(() => ({ userId: 'user-1' })),
}));

vi.mock('@/lib/totp', () => ({
  verifyTOTP: vi.fn(() => true),
  verifyBackupCode: vi.fn(() => -1),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-2fa',
    ipAddress: '203.0.113.20',
    userAgent: '2fa-context-agent',
  })),
  setSessionCookie: vi.fn(),
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
    mockSessionCreate.mockResolvedValue({ id: 'auth-session-1' });
    mockCaptureAccessAudit.mockResolvedValue('disabled');
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
    expect(mockSessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ipAddress: '203.0.113.20',
        userAgent: '2fa-context-agent',
      }),
    });
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
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});
