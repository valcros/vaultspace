import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const originalEnrollmentFlag = process.env['TWO_FACTOR_ENROLLMENT_ENABLED'];

const mockRequireAuth = vi.fn();
const mockWithOrgContext = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockVerifyTOTP = vi.fn();
const mockGenerateBackupCodes = vi.fn();
const mockHashBackupCode = vi.fn();

vi.mock('@/lib/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/totp', () => ({
  verifyTOTP: (...args: unknown[]) => mockVerifyTOTP(...args),
  generateBackupCodes: (...args: unknown[]) => mockGenerateBackupCodes(...args),
  hashBackupCode: (...args: unknown[]) => mockHashBackupCode(...args),
}));

import { POST } from './route';

describe('POST /api/auth/2fa/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TWO_FACTOR_ENROLLMENT_ENABLED'] = 'true';
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', organizationId: 'org-1' });
    mockUserFindUnique.mockResolvedValue({ twoFactorEnabled: false, twoFactorSecret: 'secret' });
    mockUserUpdate.mockResolvedValue({ id: 'user-1' });
    mockVerifyTOTP.mockReturnValue(true);
    mockGenerateBackupCodes.mockReturnValue(['backup-code']);
    mockHashBackupCode.mockReturnValue('backup-hash');
    mockWithOrgContext.mockImplementation(
      async (organizationId: string, operation: (tx: unknown) => Promise<unknown>) => {
        expect(organizationId).toBe('org-1');
        return operation({ user: { findUnique: mockUserFindUnique, update: mockUserUpdate } });
      }
    );
  });

  afterEach(() => {
    if (originalEnrollmentFlag === undefined) {
      delete process.env['TWO_FACTOR_ENROLLMENT_ENABLED'];
    } else {
      process.env['TWO_FACTOR_ENROLLMENT_ENABLED'] = originalEnrollmentFlag;
    }
  });

  it('fails closed before authentication or mutation while enrollment is disabled', async () => {
    delete process.env['TWO_FACTOR_ENROLLMENT_ENABLED'];

    const response = await POST(
      new NextRequest('http://localhost/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: '123456' }),
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Two-factor authentication enrollment is temporarily unavailable.',
    });
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(mockVerifyTOTP).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('enables 2FA inside the session organization context', async () => {
    const request = new NextRequest('http://localhost/api/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.backupCodes).toEqual(['backup-code']);
    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { twoFactorEnabled: true, twoFactorBackupCodes: ['backup-hash'] },
    });
  });

  it('does not enable 2FA for a user hidden by the organization context', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const request = new NextRequest('http://localhost/api/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(mockVerifyTOTP).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
