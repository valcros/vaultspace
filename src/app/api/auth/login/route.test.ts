import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { RateLimitError } from '@/lib/errors';

const mockCompare = vi.fn();
const mockFindLoginCandidate = vi.fn();
const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');
const mockCreateSession = vi.fn();
const mockUserUpdate = vi.fn();
const mockLoginByEmail = vi.fn().mockResolvedValue(undefined);
const mockLoginByIp = vi.fn().mockResolvedValue(undefined);
const mockIssueTenantTwoFactorChallenge = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: Parameters<typeof mockCompare>) => mockCompare(...args),
  },
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { update: vi.fn() },
  },
  withOrgContext: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      user: { update: (...args: unknown[]) => mockUserUpdate(...args) },
    }),
}));

vi.mock('@/lib/auth', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
}));

vi.mock('@/lib/auth/bootstrapRepository', () => ({
  bootstrapRepository: {
    findLoginCandidate: (...args: unknown[]) => mockFindLoginCandidate(...args),
  },
}));

vi.mock('@/lib/auth/twoFactorChallengeRepository', () => ({
  issueTenantTwoFactorChallenge: (...args: unknown[]) => mockIssueTenantTwoFactorChallenge(...args),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
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

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindLoginCandidate.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: 'stored-hash',
      userIsActive: true,
      twoFactorEnabled: true,
      organizationId: 'org-1',
      organizationName: 'Org',
      organizationSlug: 'org',
      organizationRole: 'ADMIN',
    });
    mockCompare.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue({
      session: { id: 'auth-session-1' },
      token: 't'.repeat(43),
    });
    mockUserUpdate.mockResolvedValue({});
    mockCaptureAccessAudit.mockResolvedValue('disabled');
    mockLoginByEmail.mockResolvedValue(undefined);
    mockLoginByIp.mockResolvedValue(undefined);
    mockIssueTenantTwoFactorChallenge.mockResolvedValue({
      challengeId: 'challenge-1',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
  });

  it('uses only the narrow login repository for pre-tenant candidate lookup', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/auth/login/route.ts'), 'utf8');

    expect(source).toContain('bootstrapRepository.findLoginCandidate(email)');
    expect(source).not.toMatch(/\bbootstrapDb\b/);
    expect(source).toContain('createSession(');
    expect(source).not.toContain('tx.session.create');
  });

  it('returns an opaque server-backed challenge when two-factor authentication is enabled', async () => {
    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requiresTwoFactor).toBe(true);
    expect(body.tempToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.tempToken).not.toContain('user-1');
    expect(mockIssueTenantTwoFactorChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        organizationId: 'org-1',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
      })
    );
  });

  it('captures a successful password login without making audit authoritative', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockFindLoginCandidate.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: 'stored-hash',
      userIsActive: true,
      twoFactorEnabled: false,
      organizationId: 'org-1',
      organizationName: 'Org',
      organizationSlug: 'org',
      organizationRole: 'ADMIN',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_LOGIN',
        actorType: 'ADMIN',
        actorId: 'user-1',
        metadata: expect.objectContaining({ authSessionId: 'auth-session-1' }),
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      })
    );
    expect(mockCreateSession).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      expect.objectContaining({
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        expiresAt: expect.any(Date),
      }),
      expect.anything()
    );
  });

  it('returns 429 and skips account lookup when the login rate limit is exceeded', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockLoginByEmail.mockRejectedValueOnce(new RateLimitError(60));

    const response = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toMatch(/too many/i);
    // Throttling must happen before any account lookup or bcrypt work.
    expect(mockFindLoginCandidate).not.toHaveBeenCalled();
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it('logs only categorical fields when the rate limiter is unavailable', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockLoginByEmail.mockRejectedValueOnce(new Error('sensitive provider detail'));

    try {
      const response = await POST(
        new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
        })
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('Failed to sign in');
      expect(mockFindLoginCandidate).not.toHaveBeenCalled();
      expect(mockCompare).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledOnce();

      const logged = consoleError.mock.calls[0]?.[0];
      expect(typeof logged).toBe('string');
      expect(JSON.parse(String(logged))).toEqual({
        component: 'login-api',
        outcome: 'rate-limiter-unavailable',
        reasonCode: 'LOGIN_RATE_LIMITER_UNAVAILABLE',
        requestId: 'req-test',
        errorName: 'Error',
      });
      expect(String(logged)).not.toContain('sensitive provider detail');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns a safe service failure and an observable reason when MFA challenge issuance returns no row', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockIssueTenantTwoFactorChallenge.mockResolvedValueOnce(null);

    try {
      const response = await POST(
        new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
        })
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Failed to sign in' });
      expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toEqual({
        component: 'login-api',
        outcome: 'mfa-challenge-issue-empty',
        reasonCode: 'MFA_CHALLENGE_ISSUER_EMPTY',
        requestId: 'req-test',
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps MFA issuer exceptions private while exposing a categorical server log', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockIssueTenantTwoFactorChallenge.mockRejectedValueOnce(
      new Error('TWO_FACTOR_CHALLENGE_ISSUE_ROW_INVALID')
    );

    try {
      const response = await POST(
        new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
        })
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Failed to sign in' });
      expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toEqual({
        component: 'login-api',
        outcome: 'mfa-challenge-issue-failed',
        reasonCode: 'MFA_CHALLENGE_ISSUER_INVALID_RESULT',
        requestId: 'req-test',
        errorName: 'Error',
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps a successful login available when the bounded audit write fails', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockFindLoginCandidate.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: 'stored-hash',
      userIsActive: true,
      twoFactorEnabled: false,
      organizationId: 'org-1',
      organizationName: 'Org',
      organizationSlug: 'org',
      organizationRole: 'ADMIN',
    });
    mockCaptureAccessAudit.mockResolvedValue('failed');

    const response = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
      })
    );

    expect(response.status).toBe(200);
  });

  it('returns a neutral denial without password work when no candidate resolves', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockFindLoginCandidate.mockResolvedValue(null);

    const response = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'missing@example.com', password: 'password123' }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Invalid email or password');
    expect(mockFindLoginCandidate).toHaveBeenCalledWith('missing@example.com');
    expect(mockCompare).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('preserves the neutral invalid-password response without creating a session', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockCompare.mockResolvedValue(false);

    const response = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'wrong-password' }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Invalid email or password');
    expect(mockFindLoginCandidate).toHaveBeenCalledWith('user@example.com');
    expect(mockCompare).toHaveBeenCalledWith('wrong-password', 'stored-hash');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('fails closed when the narrow repository errors and does not create a session', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockFindLoginCandidate.mockRejectedValue(new Error('narrow function unavailable'));

    const response = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to sign in');
    expect(mockCompare).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
