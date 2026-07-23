import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookieStore = {
  get: vi.fn(),
};

const mockInvalidateSession = vi.fn();
const mockClearSessionCookie = vi.fn();
const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');
const mockSessionFindUnique = vi.fn();
const mockMembershipFindUnique = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@/lib/auth', () => ({
  invalidateSession: (...args: Parameters<typeof mockInvalidateSession>) =>
    mockInvalidateSession(...args),
}));

vi.mock('@/lib/middleware', () => ({
  clearSessionCookie: (...args: Parameters<typeof mockClearSessionCookie>) =>
    mockClearSessionCookie(...args),
}));

vi.mock('@/lib/db', () => ({
  bootstrapDb: {
    session: { findUnique: (...args: unknown[]) => mockSessionFindUnique(...args) },
    userOrganization: {
      findUnique: (...args: unknown[]) => mockMembershipFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
}));

import { POST } from './route';

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieStore.get.mockReturnValue({ value: 'session-token' });
    mockInvalidateSession.mockResolvedValue(undefined);
    mockClearSessionCookie.mockResolvedValue(undefined);
    mockSessionFindUnique.mockResolvedValue({
      id: 'auth-session-1',
      userId: 'user-1',
      organizationId: 'org-1',
      user: { email: 'user@example.com' },
    });
    mockMembershipFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockCaptureAccessAudit.mockResolvedValue('disabled');
  });

  it('invalidates the session via the shared helper and clears the cookie', async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockInvalidateSession).toHaveBeenCalledWith('session-token');
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1);
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        eventType: 'USER_LOGOUT',
        actorId: 'user-1',
      })
    );
  });
});
