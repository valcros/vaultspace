import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCompare = vi.fn();
const mockFindUnique = vi.fn();

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
      session: { create: vi.fn() },
      user: { update: vi.fn() },
    }),
}));

vi.mock('@/lib/middleware', () => ({
  setSessionCookie: vi.fn(),
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
});
