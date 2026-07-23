/**
 * Authenticated profile RLS regression coverage.
 *
 * This suite uses a real organization-bound session plus the NOBYPASSRLS
 * application connection. Only the cookie adapter and cache accelerator are
 * replaced so the route can run directly under Vitest.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const cookieState = vi.hoisted(() => ({ token: '' }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (cookieState.token ? { value: cookieState.token } : undefined)),
  })),
}));

vi.mock('@/providers', () => ({
  getProviders: () => ({
    cache: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
  }),
}));

import { GET } from '@/app/api/auth/me/route';

const adminDb = new PrismaClient({
  datasources: {
    db: { url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'] },
  },
});

let org1Id: string;
let org2Id: string;
let user1Id: string;
let user2Id: string;

async function createSession(userId: string, organizationId: string | null): Promise<string> {
  const token = `auth-me-rls-${randomUUID()}`;
  await adminDb.session.create({
    data: {
      userId,
      organizationId,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return token;
}

describe('GET /api/auth/me with RLS', () => {
  beforeAll(async () => {
    const suffix = randomUUID();
    const org1 = await adminDb.organization.create({
      data: { name: 'Auth Me RLS Org 1', slug: `auth-me-rls-org-1-${suffix}` },
    });
    const org2 = await adminDb.organization.create({
      data: { name: 'Auth Me RLS Org 2', slug: `auth-me-rls-org-2-${suffix}` },
    });
    org1Id = org1.id;
    org2Id = org2.id;

    const user1 = await adminDb.user.create({
      data: {
        email: `auth-me-org-1-${suffix}@example.com`,
        passwordHash: 'integration-test-only',
        firstName: 'OrgOne',
        lastName: 'Admin',
        organizations: { create: { organizationId: org1Id, role: 'ADMIN' } },
      },
    });
    const user2 = await adminDb.user.create({
      data: {
        email: `auth-me-org-2-${suffix}@example.com`,
        passwordHash: 'integration-test-only',
        firstName: 'OrgTwo',
        lastName: 'Admin',
        organizations: { create: { organizationId: org2Id, role: 'ADMIN' } },
      },
    });
    user1Id = user1.id;
    user2Id = user2.id;
  });

  beforeEach(() => {
    cookieState.token = '';
  });

  afterAll(async () => {
    await adminDb.$disconnect();
  });

  it('returns the profile for a valid organization-bound session', async () => {
    cookieState.token = await createSession(user1Id, org1Id);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user).toEqual(
      expect.objectContaining({ id: user1Id, firstName: 'OrgOne', lastName: 'Admin' })
    );
  });

  it('does not return another tenant user when the session carries the wrong org context', async () => {
    cookieState.token = await createSession(user2Id, org1Id);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.user).toBeUndefined();
  });

  it('does not return a user when the session has no organization context', async () => {
    cookieState.token = await createSession(user1Id, null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.user).toBeUndefined();
  });
});
