import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockSessionCreate = vi.fn();
const mockCaptureAccessAudit = vi.fn();

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
});
