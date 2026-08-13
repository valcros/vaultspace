import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAuthCredential = vi.fn();
const mockWithOrgContext = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockRevokeSelfOtherSessionsInTx = vi.fn();
const mockClearSessionCache = vi.fn();
const mockHashPassword = vi.fn();
const mockVerifyPassword = vi.fn();
const mockValidatePassword = vi.fn();

vi.mock('@/lib/middleware', () => ({
  requireAuthCredential: (...args: unknown[]) => mockRequireAuthCredential(...args),
}));

vi.mock('@/lib/auth', () => ({
  clearSessionCache: (...args: unknown[]) => mockClearSessionCache(...args),
  revokeSelfOtherSessionsInTx: (...args: unknown[]) => mockRevokeSelfOtherSessionsInTx(...args),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/auth/password', () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  validatePassword: (...args: unknown[]) => mockValidatePassword(...args),
}));

import { POST } from './route';

describe('POST /api/auth/change-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthCredential.mockResolvedValue({
      token: 's'.repeat(43),
      session: {
        userId: 'user-1',
        sessionId: 'session-current',
        organizationId: 'org-1',
      },
    });
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'old-hash' });
    mockUserUpdate.mockResolvedValue({ id: 'user-1' });
    mockRevokeSelfOtherSessionsInTx.mockResolvedValue({ sessionIds: ['session-other'] });
    mockClearSessionCache.mockResolvedValue(undefined);
    mockVerifyPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockValidatePassword.mockReturnValue({ valid: true, errors: [] });
    mockHashPassword.mockResolvedValue('new-hash');
    mockWithOrgContext.mockImplementation(
      async (organizationId: string, operation: (tx: unknown) => Promise<unknown>) => {
        expect(organizationId).toBe('org-1');
        return operation({
          user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
        });
      }
    );
  });

  it('reads and updates the authenticated user inside the session organization context', async () => {
    const request = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword2!' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockWithOrgContext).toHaveBeenCalledTimes(2);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-hash' },
    });
    expect(mockRevokeSelfOtherSessionsInTx).toHaveBeenCalledWith(
      expect.any(Object),
      's'.repeat(43)
    );
    expect(mockClearSessionCache).toHaveBeenCalledWith(['session-other']);
  });

  it('does not modify a user hidden by the session organization context', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const request = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword2!' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockRevokeSelfOtherSessionsInTx).not.toHaveBeenCalled();
  });

  it('rejects a session without organization context before parsing or querying', async () => {
    mockRequireAuthCredential.mockResolvedValue({
      token: 's'.repeat(43),
      session: {
        userId: 'user-1',
        sessionId: 'session-current',
        organizationId: null,
      },
    });
    const request = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword2!' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('fails the password transaction closed when SQL does not prove the actor', async () => {
    mockRevokeSelfOtherSessionsInTx.mockResolvedValue(null);
    const request = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword2!' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(mockClearSessionCache).not.toHaveBeenCalled();
  });
});
