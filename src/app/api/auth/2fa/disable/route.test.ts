import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn();
const mockWithOrgContext = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockVerifyTOTP = vi.fn();
const mockVerifyBackupCode = vi.fn();

vi.mock('@/lib/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/totp', () => ({
  verifyTOTP: (...args: unknown[]) => mockVerifyTOTP(...args),
  verifyBackupCode: (...args: unknown[]) => mockVerifyBackupCode(...args),
}));

import { POST } from './route';

describe('POST /api/auth/2fa/disable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', organizationId: 'org-1' });
    mockUserFindUnique.mockResolvedValue({
      twoFactorEnabled: true,
      twoFactorSecret: 'secret',
      twoFactorBackupCodes: ['backup-hash'],
    });
    mockUserUpdate.mockResolvedValue({ id: 'user-1' });
    mockVerifyTOTP.mockReturnValue(true);
    mockVerifyBackupCode.mockReturnValue(-1);
    mockWithOrgContext.mockImplementation(
      async (organizationId: string, operation: (tx: unknown) => Promise<unknown>) => {
        expect(organizationId).toBe('org-1');
        return operation({ user: { findUnique: mockUserFindUnique, update: mockUserUpdate } });
      }
    );
  });

  it('disables 2FA inside the session organization context', async () => {
    const request = new NextRequest('http://localhost/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
      },
    });
  });

  it('does not disable 2FA for a user hidden by the organization context', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const request = new NextRequest('http://localhost/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(mockVerifyTOTP).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
