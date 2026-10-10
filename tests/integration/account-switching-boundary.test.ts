import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createSession } from '../../src/lib/auth/session';

const admin = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'] } },
});
const runtime = new PrismaClient();
const suffix = randomUUID();
const primaryId = `switch-primary-${suffix}`;
const secondaryId = `switch-secondary-${suffix}`;
const orgId = `switch-org-${suffix}`;

afterAll(async () => {
  await admin.accountSwitchSession.deleteMany({ where: { primaryUserId: primaryId } });
  await admin.accountLink.deleteMany({ where: { primaryUserId: primaryId } });
  await admin.session.deleteMany({ where: { userId: { in: [primaryId, secondaryId] } } });
  await admin.userOrganization.deleteMany({ where: { organizationId: orgId } });
  await admin.user.deleteMany({ where: { id: { in: [primaryId, secondaryId] } } });
  await admin.organization.deleteMany({ where: { id: orgId } });
  await Promise.all([admin.$disconnect(), runtime.$disconnect()]);
});

describe('account switching database boundary', () => {
  it('issues a membership-checked target session inside the privileged switch transaction', async () => {
    await admin.organization.create({
      data: { id: orgId, name: 'Switch Boundary Test', slug: `switch-${suffix}` },
    });
    await admin.user.createMany({
      data: [
        {
          id: primaryId,
          email: `${primaryId}@test.invalid`,
          passwordHash: 'test-only',
          firstName: 'Primary',
          lastName: 'Test',
        },
        {
          id: secondaryId,
          email: `${secondaryId}@test.invalid`,
          passwordHash: 'test-only',
          firstName: 'Secondary',
          lastName: 'Test',
        },
      ],
    });
    await admin.userOrganization.create({
      data: { userId: secondaryId, organizationId: orgId, role: 'VIEWER' },
    });
    await admin.accountLink.create({
      data: { primaryUserId: primaryId, secondaryUserId: secondaryId, verifiedAt: new Date() },
    });

    const issued = await admin.$transaction((tx) =>
      createSession(secondaryId, orgId, { userAgent: 'switch-integration-test' }, tx)
    );
    const stored = await admin.session.findUniqueOrThrow({ where: { id: issued.session.id } });
    expect(stored.userId).toBe(secondaryId);
    expect(stored.organizationId).toBe(orgId);
    expect(stored.authenticationAssurance).toBe('PASSWORD');

    await expect(
      admin.$transaction((tx) =>
        createSession(primaryId, orgId, { userAgent: 'switch-integration-test' }, tx)
      )
    ).rejects.toThrow('BOOTSTRAP_SESSION_CREATE_DENIED');
  });

  it('keeps identity links and switching grants invisible to the tenant runtime role', async () => {
    await expect(runtime.accountLink.findMany()).rejects.toThrow();
    await expect(runtime.accountSwitchSession.findMany()).rejects.toThrow();
    await expect(
      admin.accountLink.create({
        data: { primaryUserId: primaryId, secondaryUserId: primaryId, verifiedAt: new Date() },
      })
    ).rejects.toThrow();
  });
});
