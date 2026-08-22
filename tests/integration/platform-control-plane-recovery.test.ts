/** A fresh-database proof that platform grant retention makes restore fail closed. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { clearExistingDataForRestore } from '../../scripts/restore';

const sourceUrl = process.env['DATABASE_URL_ADMIN'];
if (!sourceUrl) {
  throw new Error('DATABASE_URL_ADMIN is required for platform recovery integration testing');
}
const parsedSourceUrl = new URL(sourceUrl);
if (!new Set(['localhost', '127.0.0.1', '::1']).has(parsedSourceUrl.hostname)) {
  throw new Error('Platform recovery integration testing requires local disposable PostgreSQL');
}

const databaseName = `platform_recovery_${randomUUID().replaceAll('-', '')}`;
if (!/^platform_recovery_[a-f0-9]{32}$/.test(databaseName)) {
  throw new Error('Generated platform recovery database identifier is invalid');
}
parsedSourceUrl.pathname = `/${databaseName}`;
parsedSourceUrl.searchParams.set('schema', 'public');
const isolatedDatabaseUrl = parsedSourceUrl.toString();
const provisioner = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const isolated = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl } } });
let databaseCreated = false;

describe('platform control-plane recovery boundary', () => {
  it(
    'rolls the clear phase back only because a retained platform grant blocks user deletion',
    async () => {
      await provisioner.$executeRawUnsafe(`CREATE DATABASE ${databaseName}`);
      databaseCreated = true;
      execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
        env: { ...process.env, DATABASE_URL: isolatedDatabaseUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 90_000,
      });

      const userId = `restore-subject-${randomUUID()}`;
      const actorId = `restore-actor-${randomUUID()}`;
      const organizationId = `restore-org-${randomUUID()}`;
      await isolated.organization.create({
        data: { id: organizationId, name: 'Restore Gate', slug: `restore-${randomUUID()}` },
      });
      await isolated.user.createMany({
        data: [
          {
            id: userId,
            email: `${userId}@test.invalid`,
            passwordHash: 'not-a-secret',
            firstName: 'Restore',
            lastName: 'Subject',
          },
          {
            id: actorId,
            email: `${actorId}@test.invalid`,
            passwordHash: 'not-a-secret',
            firstName: 'Restore',
            lastName: 'Actor',
          },
        ],
      });
      await isolated.userOrganization.create({ data: { userId, organizationId, role: 'VIEWER' } });
      const tenantEvent = await isolated.event.create({
        data: {
          organizationId,
          eventType: 'USER_CREATED',
          actorType: 'SYSTEM',
          actorId,
          requestId: `restore-proof-${randomUUID()}`,
        },
      });
      const grant = await isolated.platformCapabilityGrant.create({
        data: {
          userId,
          capability: 'SYSOP_AUDIT_READ',
          grantedByUserId: actorId,
          grantReasonCode: 'TEST_RESTORE',
        },
      });

      let restoreError: unknown;
      try {
        await clearExistingDataForRestore(isolated, { mode: 'truncate' });
      } catch (error) {
        restoreError = error;
      }
      expect(restoreError).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((restoreError as Prisma.PrismaClientKnownRequestError).code).toBe('P2003');
      expect(
        String((restoreError as Prisma.PrismaClientKnownRequestError).meta?.['field_name'])
      ).toContain('platform_capability_grants_userId_fkey');

      await expect(isolated.event.findUnique({ where: { id: tenantEvent.id } })).resolves.not.toBeNull();
      await expect(isolated.organization.findUnique({ where: { id: organizationId } })).resolves.not.toBeNull();
      await expect(isolated.user.findUnique({ where: { id: userId } })).resolves.not.toBeNull();
      await expect(
        isolated.userOrganization.findUnique({ where: { organizationId_userId: { organizationId, userId } } })
      ).resolves.not.toBeNull();
      await expect(isolated.platformCapabilityGrant.findUnique({ where: { id: grant.id } })).resolves.not.toBeNull();
    },
    120_000
  );
});

afterAll(async () => {
  await isolated.$disconnect();
  try {
    if (databaseCreated) {
      // The name is generated and strictly validated above. The test runs only
      // against local disposable PostgreSQL and removes no shared resource.
      await provisioner.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${databaseName}`);
    }
  } finally {
    await provisioner.$disconnect();
  }
});
