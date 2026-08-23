import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnrollmentFlag = process.env['TWO_FACTOR_ENROLLMENT_ENABLED'];

const mockRequireAuth = vi.fn();
const mockWithOrgContext = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockGenerateTOTPSecret = vi.fn();
const mockBuildOTPAuthURI = vi.fn();

vi.mock('@/lib/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/totp', () => ({
  generateTOTPSecret: (...args: unknown[]) => mockGenerateTOTPSecret(...args),
  buildOTPAuthURI: (...args: unknown[]) => mockBuildOTPAuthURI(...args),
}));

import { POST } from './route';

describe('POST /api/auth/2fa/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TWO_FACTOR_ENROLLMENT_ENABLED'] = 'true';
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', organizationId: 'org-1' });
    mockUserFindUnique.mockResolvedValue({
      email: 'admin@example.com',
      twoFactorEnabled: false,
    });
    mockUserUpdate.mockResolvedValue({ id: 'user-1' });
    mockGenerateTOTPSecret.mockReturnValue('test-secret');
    mockBuildOTPAuthURI.mockReturnValue('otpauth://totp/test');
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

    const response = await POST();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Two-factor authentication enrollment is temporarily unavailable.',
    });
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(mockGenerateTOTPSecret).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('stores the pending secret inside the session organization context', async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.secret).toBe('test-secret');
    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { twoFactorSecret: 'test-secret' },
    });
  });

  it('does not create a secret for a user hidden by the organization context', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(404);
    expect(mockGenerateTOTPSecret).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
