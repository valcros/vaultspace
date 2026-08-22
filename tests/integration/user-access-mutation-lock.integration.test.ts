import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { lockUserAccessMutation } from '@/lib/permissions/userAccessMutationLock';

function requireAdminDatabaseUrl(): string {
  const databaseUrl = process.env['DATABASE_URL_ADMIN'] ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL_ADMIN or DATABASE_URL is required for this integration test');
  }
  return databaseUrl;
}

function assertDisposableConcurrencyDatabase(databaseUrl: string): void {
  if (process.env['VAULTSPACE_CONCURRENCY_TEST_DATABASE'] !== 'true') {
    throw new Error(
      'Set VAULTSPACE_CONCURRENCY_TEST_DATABASE=true to permit concurrency test writes'
    );
  }

  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const isLocalDisposableTarget =
    process.env['DEPLOYMENT_MODE'] === 'standalone' && localHosts.has(target.hostname);
  const isNamedIsolatedTarget = databaseName.startsWith('vaultspace_concurrency_gate_');
  if (!isLocalDisposableTarget && !isNamedIsolatedTarget) {
    throw new Error(
      'Concurrency test database must be local standalone or named vaultspace_concurrency_gate_*'
    );
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitForAdvisoryLockWait(client: PrismaClient, backendPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const [state] = await client.$queryRaw<Array<{ isWaiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE pid = ${backendPid}
          AND locktype = 'advisory'
          AND NOT granted
      ) AS "isWaiting"
    `;
    if (state?.isWaiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Concurrent user-access transaction ${backendPid} did not wait for the advisory lock`
  );
}

const databaseUrl = requireAdminDatabaseUrl();
assertDisposableConcurrencyDatabase(databaseUrl);
const archiveClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const mutationClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
type Fixture = {
  organization: { id: string };
  viewer: { id: string };
  membership: { id: string };
  room: { id: string };
};
const fixtures: Fixture[] = [];

afterAll(async () => {
  await Promise.all([archiveClient.$disconnect(), mutationClient.$disconnect()]);
});

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await archiveClient.permission.deleteMany({
      where: { organizationId: fixture.organization.id, userId: fixture.viewer.id },
    });
    await archiveClient.userOrganization.deleteMany({ where: { id: fixture.membership.id } });
    await archiveClient.room.deleteMany({ where: { id: fixture.room.id } });
    await archiveClient.user.deleteMany({ where: { id: fixture.viewer.id } });
    await archiveClient.organization.deleteMany({ where: { id: fixture.organization.id } });
  }
});

async function seedViewer(): Promise<Fixture> {
  const suffix = randomUUID();
  const [organization, viewer] = await Promise.all([
    archiveClient.organization.create({
      data: { name: `Concurrency ${suffix}`, slug: `concurrency-${suffix}` },
    }),
    archiveClient.user.create({
      data: {
        email: `concurrency-${suffix}@example.test`,
        passwordHash: 'synthetic-not-a-login-secret',
        firstName: 'Concurrency',
        lastName: 'Viewer',
      },
    }),
  ]);
  const [membership, room] = await Promise.all([
    archiveClient.userOrganization.create({
      data: { organizationId: organization.id, userId: viewer.id, role: 'VIEWER' },
    }),
    archiveClient.room.create({
      data: {
        organizationId: organization.id,
        name: 'Concurrency Room',
        slug: `concurrency-room-${suffix}`,
        status: 'ACTIVE',
      },
    }),
  ]);

  const fixture = { organization, viewer, membership, room };
  fixtures.push(fixture);
  return fixture;
}

describe('user access mutation lock against PostgreSQL', () => {
  it('prevents a concurrent direct room grant after membership archive', async () => {
    const fixture = await seedViewer();
    const archiveLockHeld = deferred();
    const grantAttemptStarted = deferred();
    const allowArchiveCommit = deferred();
    let grantBackendPid = 0;

    const archive = archiveClient.$transaction(async (tx) => {
      await lockUserAccessMutation(tx, fixture.organization.id, fixture.viewer.id);
      archiveLockHeld.resolve();
      await allowArchiveCommit.promise;

      await tx.userOrganization.update({
        where: { id: fixture.membership.id },
        data: { isActive: false, archivedAt: new Date() },
      });
      await tx.permission.updateMany({
        where: {
          organizationId: fixture.organization.id,
          userId: fixture.viewer.id,
          granteeType: 'USER',
          isActive: true,
        },
        data: { isActive: false },
      });
    });

    await archiveLockHeld.promise;
    const grant = mutationClient.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid
      `;
      grantBackendPid = backend?.pid ?? 0;
      if (!grantBackendPid) {
        throw new Error('Concurrent grant transaction did not expose a PostgreSQL backend PID');
      }
      grantAttemptStarted.resolve();
      await lockUserAccessMutation(tx, fixture.organization.id, fixture.viewer.id);
      const activeMembership = await tx.userOrganization.findFirst({
        where: {
          organizationId: fixture.organization.id,
          userId: fixture.viewer.id,
          isActive: true,
          user: { isActive: true },
        },
        select: { id: true },
      });
      if (!activeMembership) {
        return 'membership-inactive';
      }
      await tx.permission.create({
        data: {
          organizationId: fixture.organization.id,
          roomId: fixture.room.id,
          resourceType: 'ROOM',
          granteeType: 'USER',
          userId: fixture.viewer.id,
          permissionLevel: 'VIEW',
        },
      });
      return 'granted';
    });

    await grantAttemptStarted.promise;
    let gateError: unknown;
    try {
      await waitForAdvisoryLockWait(archiveClient, grantBackendPid);
    } catch (error) {
      gateError = error;
    } finally {
      allowArchiveCommit.resolve();
    }
    const [, grantResult] = await Promise.all([archive, grant]);
    if (gateError) {
      throw gateError;
    }
    expect(grantResult).toBe('membership-inactive');
    await expect(
      archiveClient.userOrganization.findUnique({ where: { id: fixture.membership.id } })
    ).resolves.toMatchObject({ isActive: false });
    await expect(
      archiveClient.permission.count({
        where: {
          organizationId: fixture.organization.id,
          userId: fixture.viewer.id,
          isActive: true,
        },
      })
    ).resolves.toBe(0);
  });

  it('makes a concurrent permission update re-read a grant retired by reconciliation', async () => {
    const fixture = await seedViewer();
    const existingPermission = await archiveClient.permission.create({
      data: {
        organizationId: fixture.organization.id,
        roomId: fixture.room.id,
        resourceType: 'ROOM',
        granteeType: 'USER',
        userId: fixture.viewer.id,
        permissionLevel: 'VIEW',
      },
    });
    const reconciliationLockHeld = deferred();
    const updateAttemptStarted = deferred();
    const allowReconciliationCommit = deferred();
    let updateBackendPid = 0;

    const reconcile = archiveClient.$transaction(async (tx) => {
      await lockUserAccessMutation(tx, fixture.organization.id, fixture.viewer.id);
      reconciliationLockHeld.resolve();
      await allowReconciliationCommit.promise;
      await tx.permission.update({
        where: { id: existingPermission.id },
        data: { isActive: false },
      });
    });

    await reconciliationLockHeld.promise;
    const update = mutationClient.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid
      `;
      updateBackendPid = backend?.pid ?? 0;
      if (!updateBackendPid) {
        throw new Error('Concurrent update transaction did not expose a PostgreSQL backend PID');
      }
      updateAttemptStarted.resolve();
      await lockUserAccessMutation(tx, fixture.organization.id, fixture.viewer.id);
      const currentPermission = await tx.permission.findFirst({
        where: { id: existingPermission.id, isActive: true },
        select: { id: true },
      });
      if (!currentPermission) {
        return 'permission-retired';
      }
      await tx.permission.update({
        where: { id: currentPermission.id },
        data: { permissionLevel: 'DOWNLOAD' },
      });
      return 'updated';
    });

    await updateAttemptStarted.promise;
    let gateError: unknown;
    try {
      await waitForAdvisoryLockWait(archiveClient, updateBackendPid);
    } catch (error) {
      gateError = error;
    } finally {
      allowReconciliationCommit.resolve();
    }
    const [, updateResult] = await Promise.all([reconcile, update]);
    if (gateError) {
      throw gateError;
    }
    expect(updateResult).toBe('permission-retired');
    await expect(
      archiveClient.permission.findUnique({ where: { id: existingPermission.id } })
    ).resolves.toMatchObject({ isActive: false, permissionLevel: 'VIEW' });
  });
});
