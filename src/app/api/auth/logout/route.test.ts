import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCookieStore = {
  get: vi.fn(),
  delete: vi.fn(),
};

const mockInvalidateSession = vi.fn();
const mockClearSessionCookie = vi.fn();
const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');
const mockResolveSession = vi.fn();
const mockRevokeSysopSessions = vi.fn();
const mockStopSwitching = vi.fn();

vi.mock('@/lib/auth/accountSwitching', () => ({
  stopAccountSwitching: (...args: unknown[]) => mockStopSwitching(...args),
  SWITCH_COOKIE_NAME: 'vaultspace-account-switch',
}));

vi.mock('@/lib/sysop/platformSession', () => ({
  revokeSysopSessionsForTenantSession: (...args: unknown[]) => mockRevokeSysopSessions(...args),
  SYSOP_COOKIE_NAME: 'vaultspace-sysop',
}));

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
  getRequestContext: vi.fn(() => ({
    requestId: 'req-shared-context',
    ipAddress: '203.0.113.10',
    userAgent: 'shared-context-agent',
  })),
}));

vi.mock('@/lib/auth/bootstrapRepository', () => ({
  bootstrapRepository: {
    resolveSession: (...args: unknown[]) => mockResolveSession(...args),
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
    mockResolveSession.mockResolvedValue({
      sessionId: 'auth-session-1',
      userId: 'user-1',
      organizationId: 'org-1',
      user: { email: 'user@example.com' },
      organization: { role: 'ADMIN' },
    });
    mockCaptureAccessAudit.mockResolvedValue('disabled');
    mockRevokeSysopSessions.mockResolvedValue(undefined);
    mockStopSwitching.mockResolvedValue(undefined);
  });

  it('invalidates the session via the shared helper and clears the cookie', async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockResolveSession).toHaveBeenCalledWith('session-token');
    expect(mockInvalidateSession).toHaveBeenCalledWith('session-token');
    expect(mockRevokeSysopSessions).toHaveBeenCalledWith(
      { userId: 'user-1', sessionId: 'auth-session-1' },
      expect.stringMatching(/^logout_/)
    );
    expect(mockCookieStore.delete).toHaveBeenCalledWith('vaultspace-sysop');
    expect(mockCookieStore.delete).toHaveBeenCalledWith('vaultspace-account-switch');
    expect(mockStopSwitching).toHaveBeenCalledWith(
      { userId: 'user-1', sessionId: 'auth-session-1' },
      expect.stringMatching(/^logout_/)
    );
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1);
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        eventType: 'USER_LOGOUT',
        actorId: 'user-1',
      })
    );
  });

  it('uses the shared request context for logout audit metadata', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/auth/logout', { method: 'POST' })
    );

    expect(response.status).toBe(200);
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-shared-context',
        ipAddress: '203.0.113.10',
        userAgent: 'shared-context-agent',
      })
    );
  });
});
