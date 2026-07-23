/**
 * RLS regressions for authenticated account and invitation routes.
 *
 * Authentication is represented by an explicit session snapshot so each route
 * reaches its own organization-scoped query. Database access remains real and
 * uses the NOBYPASSRLS application connection configured by the integration
 * harness.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';

const authState = vi.hoisted(() => ({
  session: {
    userId: '',
    sessionId: 'integration-session',
    organizationId: '',
    organization: { role: 'ADMIN' as const },
  },
}));

vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(async () => authState.session),
}));

vi.mock('@/providers', () => ({
  getProviders: vi.fn(() => ({ email: { send: vi.fn(async () => undefined) } })),
}));

vi.mock('@/services/notifications', () => ({
  EmailNotificationService: vi.fn().mockImplementation(() => ({
    sendInvitationEmail: vi.fn(async () => undefined),
  })),
}));

import { POST as changePassword } from '@/app/api/auth/change-password/route';
import { POST as setupTwoFactor } from '@/app/api/auth/2fa/setup/route';
import { POST as disableTwoFactor } from '@/app/api/auth/2fa/disable/route';
import { POST as verifyTwoFactor } from '@/app/api/auth/2fa/verify/route';
import { POST as inviteUser } from '@/app/api/users/invite/route';

const adminDb = new PrismaClient({
  datasources: {
    db: { url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'] },
  },
});

let org1Id: string;
let org2Id: string;
let user1Id: string;
let user2Id: string;
let user1Email: string;
let user2Email: string;

function setSession(userId: string, organizationId: string) {
  authState.session.userId = userId;
  authState.session.organizationId = organizationId;
}

describe('authenticated account routes with RLS', () => {
  beforeAll(async () => {
    const suffix = randomUUID();
    const org1 = await adminDb.organization.create({
      data: { name: 'Account Route RLS Org 1', slug: `account-route-rls-org-1-${suffix}` },
    });
    const org2 = await adminDb.organization.create({
      data: { name: 'Account Route RLS Org 2', slug: `account-route-rls-org-2-${suffix}` },
    });
    org1Id = org1.id;
    org2Id = org2.id;
    user1Email = `account-route-org-1-${suffix}@example.com`;
    user2Email = `account-route-org-2-${suffix}@example.com`;

    const user1 = await adminDb.user.create({
      data: {
        email: user1Email,
        passwordHash: 'org-1-original-hash',
        firstName: 'OrgOne',
        lastName: 'Admin',
        organizations: { create: { organizationId: org1Id, role: 'ADMIN' } },
      },
    });
    const user2 = await adminDb.user.create({
      data: {
        email: user2Email,
        passwordHash: 'org-2-original-hash',
        firstName: 'OrgTwo',
        lastName: 'Admin',
        organizations: { create: { organizationId: org2Id, role: 'ADMIN' } },
      },
    });
    user1Id = user1.id;
    user2Id = user2.id;
  });

  beforeEach(async () => {
    process.env['APP_URL'] = 'https://integration.example.com';
    authState.session.sessionId = 'integration-session';
    await adminDb.user.update({
      where: { id: user1Id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
    });
    await adminDb.user.update({
      where: { id: user2Id },
      data: {
        passwordHash: 'org-2-original-hash',
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
      },
    });
  });

  afterAll(async () => {
    await adminDb.organization.deleteMany({ where: { id: { in: [org1Id, org2Id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: [user1Id, user2Id] } } });
    await adminDb.$disconnect();
  });

  it('allows a user mutation when the session organization matches membership', async () => {
    setSession(user1Id, org1Id);

    const response = await setupTwoFactor();
    const stored = await adminDb.user.findUnique({
      where: { id: user1Id },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });

    expect(response.status).toBe(200);
    expect(stored?.twoFactorSecret).toBeTruthy();
    expect(stored?.twoFactorEnabled).toBe(false);
  });

  it('blocks account reads and writes when the session organization is another tenant', async () => {
    setSession(user2Id, org1Id);

    const responses = await Promise.all([
      changePassword(
        new NextRequest('http://localhost/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: 'OldPassword1!',
            newPassword: 'NewPassword2!',
          }),
        })
      ),
      setupTwoFactor(),
      disableTwoFactor(
        new NextRequest('http://localhost/api/auth/2fa/disable', {
          method: 'POST',
          body: JSON.stringify({ code: '123456' }),
        })
      ),
      verifyTwoFactor(
        new NextRequest('http://localhost/api/auth/2fa/verify', {
          method: 'POST',
          body: JSON.stringify({ code: '123456' }),
        })
      ),
    ]);
    const stored = await adminDb.user.findUnique({
      where: { id: user2Id },
      select: {
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    });

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(stored).toEqual({
      passwordHash: 'org-2-original-hash',
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: [],
    });
  });

  it('does not disclose a cross-tenant account as an existing member during invitation', async () => {
    setSession(user1Id, org1Id);

    const response = await inviteUser(
      new NextRequest('http://localhost/api/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: user2Email }),
      })
    );
    const stored = await adminDb.invitation.findFirst({
      where: { organizationId: org1Id, email: user2Email },
      select: { organizationId: true, email: true, status: true },
    });

    expect(response.status).toBe(201);
    expect(stored).toEqual({ organizationId: org1Id, email: user2Email, status: 'PENDING' });
  });

  it('still rejects an invitation for an existing member of the session organization', async () => {
    setSession(user1Id, org1Id);

    const response = await inviteUser(
      new NextRequest('http://localhost/api/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: user1Email }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'User is already a member of this organization',
    });
  });
});
