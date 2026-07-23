import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCompare = vi.fn();
const mockFindUnique = vi.fn();
const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');
const mockSessionCreate = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: Parameters<typeof mockCompare>) => mockCompare(...args),
  },
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { update: vi.fn() },
    session: { create: vi.fn() },
  },
  bootstrapDb: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
  withOrgContext: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      session: { create: (...args: unknown[]) => mockSessionCreate(...args) },
      user: { update: (...args: unknown[]) => mockUserUpdate(...args) },
    }),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
  setSessionCookie: vi.fn(),
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
}));

import { POST } from './route';

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: 'stored-hash',
      isActive: true,
      twoFactorEnabled: true,
      organizations: [
        {
          role: 'ADMIN',
          organization: {
            id: 'org-1',
            name: 'Org',
            slug: 'org',
            isActive: true,
          },
        },
      ],
    });
    mockCompare.mockResolvedValue(true);
    mockSessionCreate.mockResolvedValue({ id: 'auth-session-1' });
    mockUserUpdate.mockResolvedValue({});
    mockCaptureAccessAudit.mockResolvedValue('disabled');
  });

  it('returns 500 instead of using a weak fallback when SESSION_SECRET is missing', async () => {
    delete process.env['SESSION_SECRET'];

    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to sign in');
  });

  it('returns a signed temp token when SESSION_SECRET is configured', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';

    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requiresTwoFactor).toBe(true);
    expect(body.tempToken).toMatch(/^user-1:\d+:[a-f0-9]+$/);
  });

  it('captures a successful password login without making audit authoritative', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: 'stored-hash',
      isActive: true,
      twoFactorEnabled: false,
      organizations: [
        {
          role: 'ADMIN',
          organization: {
            id: 'org-1',
            name: 'Org',
            slug: 'org',
            isActive: true,
          },
        },
      ],
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
      })
    );
  });

  it('keeps a successful login available when the bounded audit write fails', async () => {
    process.env['SESSION_SECRET'] = 'test-session-secret';
    mockFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: 'stored-hash',
      isActive: true,
      twoFactorEnabled: false,
      organizations: [
        {
          role: 'ADMIN',
          organization: {
            id: 'org-1',
            name: 'Org',
            slug: 'org',
            isActive: true,
          },
        },
      ],
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
});
