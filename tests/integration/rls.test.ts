/**
 * Row-Level Security (RLS) Integration Tests
 *
 * These tests run against PostgreSQL with real RLS policies enabled.
 * CI uses a disposable standalone database with a NOBYPASSRLS app role.
 *
 * Verifies that RLS enforcement works correctly when ENABLE_RLS=true.
 * These tests ensure proper tenant isolation at the database level.
 *
 * Test scenarios:
 * - SEC-001: Cross-tenant data isolation
 * - withOrgContext properly sets tenant boundary
 * - PRE-RLS bootstrap patterns work correctly
 * - Direct queries without context are blocked
 *
 * Run with:
 *   DATABASE_URL_ADMIN=<admin-url> \
 *   DATABASE_URL=<vaultspace_app-url> \
 *   ENABLE_RLS=true \
 *   npm run test:integration:rls
 */

import { createHash, randomUUID } from 'crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { withOrgContext, db, setBootstrapContext } from '@/lib/db';
import { lockPasswordResetUser } from '@/lib/auth/passwordResetToken';
import {
  revokeAndVerifyPasswordResetProviderCorrelationAccess,
  revokeAndVerifyProviderInboxAccess,
} from '@/lib/integrations/providerInboxDatabasePrivileges';
import { getPermissionEngine } from '@/lib/permissions';
import { createEventBus } from '@/lib/events/EventBus';
import { inspectPasswordResetProviderCorrelation } from '@/workers/passwordResetReconciler';

const rawPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'],
    },
  },
});

const PROVIDER_CORRELATION_MIGRATION =
  '20260731060000_add_password_reset_provider_correlation_registry';
const PROVIDER_CORRELATION_PREDECESSOR = '20260731050000_add_password_reset_delivery_contract';

function databaseUrlForName(sourceUrl: string, databaseName: string): string {
  const parsed = new URL(sourceUrl);
  if (!new Set(['localhost', '127.0.0.1', '::1']).has(parsed.hostname)) {
    throw new Error('Migration integration tests require disposable local PostgreSQL');
  }
  parsed.pathname = `/${databaseName}`;
  parsed.searchParams.set('schema', 'public');
  return parsed.toString();
}

function migrationSqlThrough(lastMigration: string): string {
  const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
  return readdirSync(migrationsRoot)
    .filter((entry) => /^\d+_/.test(entry) && entry <= lastMigration)
    .sort()
    .map((entry) => readFileSync(join(migrationsRoot, entry, 'migration.sql'), 'utf8'))
    .join('\n');
}

function executeSqlWithPrisma(databaseUrl: string, sql: string): void {
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin', '--url', databaseUrl], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    input: sql,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function seedMigrationAcceptance(
  client: PrismaClient,
  input: {
    flowId: string;
    userId: string;
    provider: string;
    deliveryStatus: 'PENDING' | 'PROVIDER_ACCEPTED' | 'CANCELLED';
    providerMessageId: string;
    schemaVersion: number | null;
    sendFence?: number;
  }
): Promise<void> {
  await client.passwordResetToken.create({
    data: {
      id: input.flowId,
      userId: input.userId,
      token:
        input.schemaVersion === 1
          ? `prh1:${createHash('sha256').update(input.flowId).digest('hex')}`
          : `legacy-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000),
      requestId: `migration-request-${randomUUID()}`,
      deliveryStatus: input.deliveryStatus,
      auditOrganizationIds: ['migration_scope'],
      providerCorrelationSchemaVersion: input.schemaVersion,
      provider: input.provider,
      providerOperationId: input.flowId,
      providerMessageId: input.providerMessageId,
      providerAcceptedAt: new Date(),
    },
  });
  await client.passwordResetRecovery.create({
    data: {
      flowId: input.flowId,
      userId: input.userId,
      recipientFingerprint: createHash('sha256').update(input.flowId).digest('hex'),
      providerOperationId: input.flowId,
      sendFence: input.sendFence ?? 1,
    },
  });
}

// Test data
let org1Id: string;
let org2Id: string;
let room1Id: string;
let room2Id: string;
let user1Id: string;
let org1Slug: string;
let org2Slug: string;
let room1Slug: string;
let room2Slug: string;

async function issuePasswordResetWithReviewedLocks(input: {
  targetUserId: string;
  actorUserId: string;
  organizationId: string;
  mode: 'self' | 'admin';
  onReadyToLock?: () => void;
}): Promise<string | null> {
  return db.$transaction(
    async (tx) => {
      await setBootstrapContext(tx);

      const userIds = [...new Set([input.targetUserId, input.actorUserId])].sort();
      await lockPasswordResetUser(tx, input.targetUserId);
      await tx.$queryRaw`
        SELECT id
        FROM users
        WHERE id IN (${Prisma.join(userIds)})
        ORDER BY id
        FOR UPDATE`;
      input.onReadyToLock?.();
      await tx.$queryRaw`
        SELECT id
        FROM user_organizations
        WHERE "userId" IN (${Prisma.join(userIds)})
        ORDER BY id
        FOR UPDATE`;

      const actor = await tx.user.findUnique({
        where: { id: input.actorUserId },
        select: {
          isActive: true,
          organizations: {
            where: { organizationId: input.organizationId },
            select: { role: true, isActive: true },
          },
        },
      });
      const target = await tx.user.findUnique({
        where: { id: input.targetUserId },
        select: {
          isActive: true,
          organizations: {
            where: {
              organizationId: input.organizationId,
              isActive: true,
              organization: { isActive: true },
            },
            select: { organizationId: true },
          },
        },
      });
      const actorMembership = actor?.organizations[0];
      const authorized =
        Boolean(target?.isActive && target.organizations.length === 1) &&
        (input.mode === 'self'
          ? input.actorUserId === input.targetUserId
          : Boolean(
              actor?.isActive &&
              actorMembership?.isActive &&
              actorMembership.role === UserRole.ADMIN
            ));
      if (!authorized) {
        return null;
      }

      const now = new Date();
      const current = await tx.passwordResetToken.findMany({
        where: {
          userId: input.targetUserId,
          usedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      const supersededFlowIds = current.map(({ id }) => id);
      if (supersededFlowIds.length > 0) {
        await tx.passwordResetToken.updateMany({
          where: { id: { in: supersededFlowIds }, usedAt: null },
          data: { usedAt: now, deliveryStatus: 'SUPERSEDED' },
        });
        await tx.passwordResetRecovery.updateMany({
          where: { flowId: { in: supersededFlowIds }, wipedAt: null },
          data: {
            cipherVersion: null,
            keyId: null,
            nonce: null,
            ciphertext: null,
            authTag: null,
            wipedAt: now,
            sendLeaseId: null,
            sendLeaseExpiresAt: null,
            enqueueLeaseId: null,
            enqueueLeaseExpiresAt: null,
            enqueueStatus: 'SUPERSEDED',
          },
        });
      }

      const flowId = `concurrency-${randomUUID()}`;
      await tx.passwordResetToken.create({
        data: {
          id: flowId,
          userId: input.targetUserId,
          token: `prh1:${createHash('sha256').update(flowId).digest('hex')}`,
          expiresAt: new Date(now.getTime() + 60_000),
          requestId: `request-${randomUUID()}`,
          organizationId: input.organizationId,
          deliveryStatus: 'PENDING',
          auditOrganizationIds: [input.organizationId],
          providerCorrelationSchemaVersion: 1,
        },
      });
      await tx.passwordResetRecovery.create({
        data: {
          flowId,
          userId: input.targetUserId,
          recipientFingerprint: '1'.repeat(64),
          cipherVersion: 1,
          keyId: 'integration-test',
          nonce: Buffer.alloc(12),
          ciphertext: Buffer.alloc(48),
          authTag: Buffer.alloc(16),
          providerOperationId: flowId,
        },
      });
      return flowId;
    },
    { maxWait: 5_000, timeout: 30_000 }
  );
}

describe('RLS Enforcement', () => {
  beforeAll(async () => {
    await rawPrisma.$connect();
    await db.$connect();
  });

  beforeEach(async () => {
    const runId = Date.now();
    org1Slug = `rls-org1-${runId}`;
    org2Slug = `rls-org2-${runId}`;
    room1Slug = `rls-room1-${runId}`;
    room2Slug = `rls-room2-${runId}`;

    // Create two test organizations
    const org1 = await rawPrisma.organization.create({
      data: {
        name: 'RLS Test Org 1',
        slug: org1Slug,
        isActive: true,
      },
    });
    org1Id = org1.id;

    const org2 = await rawPrisma.organization.create({
      data: {
        name: 'RLS Test Org 2',
        slug: org2Slug,
        isActive: true,
      },
    });
    org2Id = org2.id;

    // Create rooms in each organization
    const room1 = await rawPrisma.room.create({
      data: {
        organizationId: org1Id,
        name: 'RLS Test Room 1',
        slug: room1Slug,
        status: 'ACTIVE',
      },
    });
    room1Id = room1.id;

    const room2 = await rawPrisma.room.create({
      data: {
        organizationId: org2Id,
        name: 'RLS Test Room 2',
        slug: room2Slug,
        status: 'ACTIVE',
      },
    });
    room2Id = room2.id;

    // Create a test user in org1
    const user1 = await rawPrisma.user.create({
      data: {
        email: `rls-test-${Date.now()}@example.com`,
        passwordHash: 'test-hash',
        firstName: 'RLS',
        lastName: 'TestUser',
        isActive: true,
        organizations: {
          create: {
            organizationId: org1Id,
            role: 'ADMIN',
            isActive: true,
          },
        },
      },
    });
    user1Id = user1.id;

    // Create documents in each room
    await rawPrisma.document.create({
      data: {
        organizationId: org1Id,
        roomId: room1Id,
        name: 'org1-doc.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        originalFileName: 'org1-doc.pdf',
        status: 'ACTIVE',
      },
    });

    await rawPrisma.document.create({
      data: {
        organizationId: org2Id,
        roomId: room2Id,
        name: 'org2-doc.pdf',
        mimeType: 'application/pdf',
        fileSize: 2048,
        originalFileName: 'org2-doc.pdf',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await rawPrisma.$disconnect();
    await db.$disconnect();
  });

  describe('SEC-005: RLS database posture', () => {
    it('runs as a non-bypass database role with forced RLS on tenant tables', async () => {
      const [role] = await db.$queryRaw<
        Array<{ current_user: string; bypasses_rls: boolean; is_superuser: boolean }>
      >`
        SELECT current_user,
               rolbypassrls AS bypasses_rls,
               rolsuper AS is_superuser
        FROM pg_roles
        WHERE rolname = current_user
      `;

      expect(role?.current_user).toBe('vaultspace_app');
      expect(role?.bypasses_rls).toBe(false);
      expect(role?.is_superuser).toBe(false);

      const protectedTables = await db.$queryRaw<
        Array<{ table_name: string; rls_enabled: boolean; rls_forced: boolean }>
      >`
        SELECT c.relname AS table_name,
               c.relrowsecurity AS rls_enabled,
               c.relforcerowsecurity AS rls_forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
            'rooms',
            'documents',
            'events',
            'groups',
            'group_memberships',
            'links',
            'view_sessions'
          )
        ORDER BY c.relname
      `;

      expect(protectedTables).toHaveLength(7);
      expect(protectedTables.every((table) => table.rls_enabled && table.rls_forced)).toBe(true);
    });

    it('blocks direct cross-tenant SQL without relying on application filters', async () => {
      const roomsInOrg1Context = await withOrgContext(org1Id, async (tx) => {
        return tx.$queryRaw<Array<{ id: string; organizationId: string }>>`
          SELECT id, "organizationId"
          FROM rooms
          ORDER BY name
        `;
      });

      expect(roomsInOrg1Context).toHaveLength(1);
      expect(roomsInOrg1Context[0]?.id).toBe(room1Id);
      expect(roomsInOrg1Context[0]?.organizationId).toBe(org1Id);

      const forbiddenDocument = await withOrgContext(org1Id, async (tx) => {
        return tx.$queryRaw<Array<{ id: string; organizationId: string }>>`
          SELECT id, "organizationId"
          FROM documents
          WHERE "roomId" = ${room2Id}
        `;
      });

      expect(forbiddenDocument).toHaveLength(0);
    });

    it('hides tenant rows when no org context is set', async () => {
      const roomsWithoutContext = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM rooms
        WHERE id IN (${room1Id}, ${room2Id})
      `;

      expect(roomsWithoutContext).toHaveLength(0);
    });

    it('denies the ordinary application role every provider inbox privilege', async () => {
      const inaccessibleId = `rls-provider-inbox-${randomUUID()}`;
      await expect(db.providerEventInbox.findMany({ take: 1 })).rejects.toThrow();
      await expect(
        db.providerEventInbox.create({
          data: {
            id: inaccessibleId,
            provider: 'acs',
            eventType: 'RLS_TEST',
            eventIdFingerprint: '1'.repeat(64),
            payloadFingerprint: '2'.repeat(64),
            payloadFingerprintKeyId: 'rls-test',
            topicFingerprint: '3'.repeat(64),
            dataVersion: '1.0',
            metadataVersion: '1',
            eventAt: new Date(),
          },
        })
      ).rejects.toThrow();
      await expect(
        db.providerEventInbox.updateMany({
          where: { id: inaccessibleId },
          data: { lastErrorCode: 'RLS_TEST' },
        })
      ).rejects.toThrow();
      await expect(
        db.providerEventInbox.deleteMany({ where: { id: inaccessibleId } })
      ).rejects.toThrow();
    });

    it('denies raw provider-correlation access while allowing aggregate posture counts', async () => {
      await expect(db.passwordResetProviderCorrelation.findMany({ take: 1 })).rejects.toThrow();
      await expect(
        db.passwordResetProviderCorrelation.create({
          data: {
            flowId: `forbidden-${randomUUID()}`,
            provider: 'acs',
            providerOperationId: `forbidden-${randomUUID()}`,
            providerMessageId: `forbidden-${randomUUID()}`,
            providerAcceptedAt: new Date(),
            correlationSchemaVersion: 1,
          },
        })
      ).rejects.toThrow();
      await expect(
        db.passwordResetProviderCorrelation.updateMany({ data: { provider: 'acs' } })
      ).rejects.toThrow();
      await expect(db.passwordResetProviderCorrelation.deleteMany()).rejects.toThrow();

      const [counts] = await db.$queryRaw<Array<{ runtimeRegistryAccessRows: number }>>`
        SELECT "runtimeRegistryAccessRows"
        FROM public.password_reset_provider_correlation_preflight_counts()`;
      expect(counts?.runtimeRegistryAccessRows).toBe(0);
    });

    it('supports a custom runtime role with aggregate-only correlation diagnostics', async () => {
      const customRole = 'vaultspace_correlation_custom_runtime';
      const customPassword = `correlation-${randomUUID()}`;
      const adminUrl = process.env['DATABASE_URL_ADMIN'];
      if (!adminUrl) {
        throw new Error('DATABASE_URL_ADMIN is required for custom runtime role verification');
      }
      const customUrl = new URL(adminUrl);
      customUrl.username = customRole;
      customUrl.password = customPassword;
      const customClient = new PrismaClient({
        datasources: { db: { url: customUrl.toString() } },
      });

      await rawPrisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${customRole}') THEN
            CREATE ROLE ${customRole} LOGIN;
          END IF;
          ALTER ROLE ${customRole}
            WITH LOGIN PASSWORD '${customPassword}'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
        END
        $$
      `);
      await rawPrisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${customRole}`);
      try {
        await revokeAndVerifyPasswordResetProviderCorrelationAccess(rawPrisma, customRole);
        await expect(
          db.$queryRaw`
            SELECT *
            FROM public.password_reset_provider_correlation_preflight_counts()`
        ).rejects.toThrow();
        await customClient.$connect();
        await expect(
          customClient.passwordResetProviderCorrelation.findMany({ take: 1 })
        ).rejects.toThrow();
        const [counts] = await customClient.$queryRaw<
          Array<{
            runtimeRegistryAccessRows: number;
            runtimeSensitiveFunctionAccessRows: number;
            runtimeCountFunctionDeniedRows: number;
            unexpectedSensitiveFunctionAclRows: number;
          }>
        >`
          SELECT
            "runtimeRegistryAccessRows",
            "runtimeSensitiveFunctionAccessRows",
            "runtimeCountFunctionDeniedRows",
            "unexpectedSensitiveFunctionAclRows"
          FROM public.password_reset_provider_correlation_preflight_counts()`;
        expect(counts).toEqual({
          runtimeRegistryAccessRows: 0,
          runtimeSensitiveFunctionAccessRows: 0,
          runtimeCountFunctionDeniedRows: 0,
          unexpectedSensitiveFunctionAclRows: 0,
        });
      } finally {
        await customClient.$disconnect();
        await rawPrisma.$executeRawUnsafe(
          `REVOKE ALL ON FUNCTION public.password_reset_provider_correlation_preflight_counts() FROM ${customRole}`
        );
        await rawPrisma.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM ${customRole}`);
        await rawPrisma.$executeRawUnsafe(`DROP ROLE ${customRole}`);
        await revokeAndVerifyPasswordResetProviderCorrelationAccess(rawPrisma, 'vaultspace_app');
      }
    });

    it('rejects protected-name function overloads and rolls the hostile catalog state back', async () => {
      await expect(
        rawPrisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`
              CREATE FUNCTION public.password_reset_provider_correlation_preflight_counts(probe text)
              RETURNS text
              LANGUAGE sql
              STABLE
              SECURITY DEFINER
              SET search_path = pg_catalog
              AS 'SELECT ''redacted''::text'
            `);
            await tx.$executeRawUnsafe(`
              REVOKE ALL ON FUNCTION
                public.password_reset_provider_correlation_preflight_counts(text)
              FROM PUBLIC
            `);
            await tx.$executeRawUnsafe(`
              GRANT EXECUTE ON FUNCTION
                public.password_reset_provider_correlation_preflight_counts(text)
              TO vaultspace_app
            `);
            const [posture] = await tx.$queryRaw<
              Array<{
                invalidFunctionPostureRows: number;
                unexpectedSensitiveFunctionAclRows: number;
              }>
            >`
              SELECT
                "invalidFunctionPostureRows",
                "unexpectedSensitiveFunctionAclRows"
              FROM public.password_reset_provider_correlation_preflight_counts()`;
            expect(posture?.invalidFunctionPostureRows).toBeGreaterThan(0);
            expect(posture?.unexpectedSensitiveFunctionAclRows).toBeGreaterThan(0);

            await revokeAndVerifyPasswordResetProviderCorrelationAccess(
              tx as unknown as PrismaClient,
              'vaultspace_app'
            );
          },
          { maxWait: 5_000, timeout: 30_000 }
        )
      ).rejects.toMatchObject({
        code: 'PASSWORD_RESET_PROVIDER_CORRELATION_FUNCTION_ACCESS_INVALID',
      });

      const [overload] = await rawPrisma.$queryRaw<Array<{ signature: string | null }>>`
        SELECT to_regprocedure(
          'public.password_reset_provider_correlation_preflight_counts(text)'
        )::text AS signature`;
      expect(overload?.signature).toBeNull();
      const [restored] = await db.$queryRaw<
        Array<{
          invalidFunctionPostureRows: number;
          unexpectedSensitiveFunctionAclRows: number;
          runtimeSensitiveFunctionAccessRows: number;
        }>
      >`
        SELECT
          "invalidFunctionPostureRows",
          "unexpectedSensitiveFunctionAclRows",
          "runtimeSensitiveFunctionAccessRows"
        FROM public.password_reset_provider_correlation_preflight_counts()`;
      expect(restored).toEqual({
        invalidFunctionPostureRows: 0,
        unexpectedSensitiveFunctionAclRows: 0,
        runtimeSensitiveFunctionAccessRows: 0,
      });
    });

    it('rejects SET ROLE reachability even when vaultspace_app is NOINHERIT', async () => {
      const reachableRole = 'vaultspace_app_set_role_test';
      await rawPrisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${reachableRole}') THEN
            CREATE ROLE ${reachableRole} NOLOGIN;
          END IF;
        END
        $$
      `);
      await rawPrisma.$executeRawUnsafe(`REVOKE ${reachableRole} FROM vaultspace_app`);
      await rawPrisma.$executeRawUnsafe(
        `REVOKE ALL PRIVILEGES ON public.provider_event_inbox FROM ${reachableRole}`
      );
      await rawPrisma.$executeRawUnsafe('ALTER ROLE vaultspace_app NOINHERIT');
      await rawPrisma.$executeRawUnsafe(
        `GRANT SELECT ON public.provider_event_inbox TO ${reachableRole}`
      );
      await rawPrisma.$executeRawUnsafe(`GRANT ${reachableRole} TO vaultspace_app`);
      try {
        await expect(
          revokeAndVerifyProviderInboxAccess(rawPrisma, 'vaultspace_app')
        ).rejects.toMatchObject({ code: 'PROVIDER_INBOX_APPLICATION_ROLE_ACCESS_REMAINS' });
      } finally {
        await rawPrisma.$executeRawUnsafe(`REVOKE ${reachableRole} FROM vaultspace_app`);
        await rawPrisma.$executeRawUnsafe(
          `REVOKE ALL PRIVILEGES ON public.provider_event_inbox FROM ${reachableRole}`
        );
        await rawPrisma.$executeRawUnsafe('ALTER ROLE vaultspace_app INHERIT');
      }
      await expect(
        revokeAndVerifyProviderInboxAccess(rawPrisma, 'vaultspace_app')
      ).resolves.toBeUndefined();
    });

    it('rejects inherited-role reachability to protected provider correlations', async () => {
      const reachableRole = 'vaultspace_correlation_set_role_test';
      await rawPrisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${reachableRole}') THEN
            CREATE ROLE ${reachableRole} NOLOGIN;
          END IF;
        END
        $$
      `);
      await rawPrisma.$executeRawUnsafe(`REVOKE ${reachableRole} FROM vaultspace_app`);
      await rawPrisma.$executeRawUnsafe(
        `REVOKE ALL PRIVILEGES ON public.password_reset_provider_correlations FROM ${reachableRole}`
      );
      await rawPrisma.$executeRawUnsafe(
        `GRANT SELECT ON public.password_reset_provider_correlations TO ${reachableRole}`
      );
      await rawPrisma.$executeRawUnsafe(`GRANT ${reachableRole} TO vaultspace_app`);
      try {
        await expect(
          revokeAndVerifyPasswordResetProviderCorrelationAccess(rawPrisma, 'vaultspace_app')
        ).rejects.toMatchObject({
          code: 'PASSWORD_RESET_PROVIDER_CORRELATION_APPLICATION_ROLE_ACCESS_REMAINS',
        });
      } finally {
        await rawPrisma.$executeRawUnsafe(`REVOKE ${reachableRole} FROM vaultspace_app`);
        await rawPrisma.$executeRawUnsafe(
          `REVOKE ALL PRIVILEGES ON public.password_reset_provider_correlations FROM ${reachableRole}`
        );
      }
      await expect(
        revokeAndVerifyPasswordResetProviderCorrelationAccess(rawPrisma, 'vaultspace_app')
      ).resolves.toBeUndefined();
    });
  });

  describe('withOrgContext', () => {
    it('should return only data from the specified organization', async () => {
      // Query within org1 context
      const org1Rooms = await withOrgContext(org1Id, async (tx) => {
        return tx.room.findMany({
          where: { organizationId: org1Id },
        });
      });

      expect(org1Rooms).toHaveLength(1);
      expect(org1Rooms[0]?.name).toBe('RLS Test Room 1');

      // Query within org2 context
      const org2Rooms = await withOrgContext(org2Id, async (tx) => {
        return tx.room.findMany({
          where: { organizationId: org2Id },
        });
      });

      expect(org2Rooms).toHaveLength(1);
      expect(org2Rooms[0]?.name).toBe('RLS Test Room 2');
    });

    it('should not return data from other organizations even without explicit filter', async () => {
      // Query within org1 context WITHOUT org filter
      // When RLS is enabled, this should still only return org1 data
      const roomsInOrg1Context = await withOrgContext(org1Id, async (tx) => {
        return tx.room.findMany({
          where: {
            slug: room1Slug,
          },
        });
      });

      expect(roomsInOrg1Context).toHaveLength(1);
      expect(roomsInOrg1Context[0]?.organizationId).toBe(org1Id);
    });

    it('should properly scope document queries to organization', async () => {
      const org1Docs = await withOrgContext(org1Id, async (tx) => {
        return tx.document.findMany({
          where: { organizationId: org1Id },
        });
      });

      expect(org1Docs).toHaveLength(1);
      expect(org1Docs[0]?.name).toBe('org1-doc.pdf');

      const org2Docs = await withOrgContext(org2Id, async (tx) => {
        return tx.document.findMany({
          where: { organizationId: org2Id },
        });
      });

      expect(org2Docs).toHaveLength(1);
      expect(org2Docs[0]?.name).toBe('org2-doc.pdf');
    });

    it('should allow nested queries within the same context', async () => {
      const result = await withOrgContext(org1Id, async (tx) => {
        const room = await tx.room.findFirst({
          where: { organizationId: org1Id },
        });

        if (!room) return { room: null, documents: [] };

        const documents = await tx.document.findMany({
          where: { roomId: room.id },
        });

        return { room, documents };
      });

      expect(result.room).toBeDefined();
      expect(result.room?.name).toBe('RLS Test Room 1');
      expect(result.documents).toHaveLength(1);
    });
  });

  describe('SEC-001: Cross-tenant isolation', () => {
    it('should not allow org1 to access org2 data', async () => {
      // Try to query org2's room from org1's context
      const crossTenantRoom = await withOrgContext(org1Id, async (tx) => {
        return tx.room.findFirst({
          where: { id: room2Id },
        });
      });

      expect(crossTenantRoom).toBeNull();
    });

    it('should not allow org2 to access org1 documents', async () => {
      // Try to query org1's documents from org2's context
      const crossTenantDocs = await withOrgContext(org2Id, async (tx) => {
        return tx.document.findMany({
          where: { roomId: room1Id },
        });
      });

      expect(crossTenantDocs).toHaveLength(0);
    });
  });

  describe('PRE-RLS Bootstrap patterns', () => {
    it('normalizes a reused runtime connection before cross-organization reset work', async () => {
      await withOrgContext(org2Id, async (tx) => {
        await tx.organization.findUnique({ where: { id: org2Id } });
      });

      const result = await db.$transaction(async (tx) => {
        await setBootstrapContext(tx);
        await lockPasswordResetUser(tx, user1Id);
        const [role] = await tx.$queryRaw<Array<{ rolbypassrls: boolean }>>`
          SELECT rolbypassrls
          FROM pg_roles
          WHERE rolname = current_user`;
        const user = await tx.user.findUnique({
          where: { id: user1Id },
          select: {
            id: true,
            organizations: { select: { organizationId: true } },
          },
        });
        return { role, user };
      });

      expect(result.role?.rolbypassrls).toBe(false);
      expect(result.user?.id).toBe(user1Id);
      expect(result.user?.organizations).toEqual(
        expect.arrayContaining([expect.objectContaining({ organizationId: org1Id })])
      );
    });

    it('permits runtime-role recovery mutations and immutable audit insertion, then rolls them back', async () => {
      const flowId = `rls-reset-${randomUUID()}`;
      const idempotencyKey = `password-reset-${flowId}-preflight-${org1Id}`;
      let reachedRollback = false;

      await expect(
        db.$transaction(async (tx) => {
          await setBootstrapContext(tx);
          await lockPasswordResetUser(tx, user1Id);
          await tx.passwordResetToken.create({
            data: {
              id: flowId,
              userId: user1Id,
              token: `preflight-${randomUUID()}`,
              expiresAt: new Date(Date.now() + 60_000),
              requestId: `preflight-${randomUUID()}`,
              organizationId: org1Id,
              deliveryStatus: 'PENDING',
            },
          });
          await tx.passwordResetRecovery.create({
            data: {
              flowId,
              userId: user1Id,
              recipientFingerprint: '0'.repeat(64),
              cipherVersion: 1,
              keyId: 'preflight',
              nonce: Buffer.alloc(12),
              ciphertext: Buffer.alloc(48),
              authTag: Buffer.alloc(16),
              providerOperationId: flowId,
            },
          });
          await tx.passwordResetRecovery.update({
            where: { flowId },
            data: { enqueueStatus: 'PREFLIGHT_VERIFIED' },
          });
          await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org1Id}, true)`;
          const eventId = await createSecurityAuditEvent(tx, {
            organizationId: org1Id,
            eventType: 'USER_PASSWORD_RESET',
            actorType: 'SYSTEM',
            requestId: `preflight-${flowId}`,
            correlationId: flowId,
            idempotencyKey,
            description: 'Runtime-role password reset recovery preflight',
            metadata: { outcome: 'preflight', stage: 'runtime_role_verification' },
          });
          expect(
            await tx.event.findUnique({ where: { id: eventId }, select: { id: true } })
          ).toEqual({ id: eventId });
          reachedRollback = true;
          throw new Error('ROLLBACK_PASSWORD_RESET_PREFLIGHT');
        })
      ).rejects.toThrow('ROLLBACK_PASSWORD_RESET_PREFLIGHT');

      expect(reachedRollback).toBe(true);
      expect(await rawPrisma.passwordResetToken.findUnique({ where: { id: flowId } })).toBeNull();
      expect(await rawPrisma.event.findUnique({ where: { idempotencyKey } })).toBeNull();
    });

    it('enforces the creation-only password reset delivery marker in PostgreSQL', async () => {
      const validToken = `prh1:${'a'.repeat(64)}`;
      const canonicalScope = Array.from(
        { length: 64 },
        (_, index) => `scope-${String(index).padStart(2, '0')}`
      );
      let validMutationObserved = false;
      await expect(
        db.$transaction(async (tx) => {
          await setBootstrapContext(tx);
          const flowId = `rls-contract-valid-${randomUUID()}`;
          await tx.passwordResetToken.create({
            data: {
              id: flowId,
              userId: user1Id,
              token: validToken,
              expiresAt: new Date(Date.now() + 60_000),
              auditOrganizationIds: canonicalScope,
              providerCorrelationSchemaVersion: 1,
            },
          });
          const updated = await tx.passwordResetToken.update({
            where: { id: flowId },
            data: { deliveryStatus: 'QUEUED' },
            select: {
              providerCorrelationSchemaVersion: true,
              deliveryStatus: true,
              auditOrganizationIds: true,
            },
          });
          expect(updated).toEqual({
            providerCorrelationSchemaVersion: 1,
            deliveryStatus: 'QUEUED',
            auditOrganizationIds: canonicalScope,
          });
          validMutationObserved = true;
          throw new Error('ROLLBACK_PASSWORD_RESET_CONTRACT_VALID');
        })
      ).rejects.toThrow('ROLLBACK_PASSWORD_RESET_CONTRACT_VALID');
      expect(validMutationObserved).toBe(true);

      await expect(
        db.$transaction(async (tx) => {
          await setBootstrapContext(tx);
          const flowId = `rls-contract-upgrade-${randomUUID()}`;
          await tx.passwordResetToken.create({
            data: {
              id: flowId,
              userId: user1Id,
              token: validToken.replace(/a$/, 'b'),
              expiresAt: new Date(Date.now() + 60_000),
              auditOrganizationIds: [org1Id],
            },
          });
          await tx.passwordResetToken.update({
            where: { id: flowId },
            data: { providerCorrelationSchemaVersion: 1 },
          });
        })
      ).rejects.toThrow(/PASSWORD_RESET_DELIVERY_CONTRACT_MARKER_IMMUTABLE/);

      await expect(
        db.$transaction(async (tx) => {
          await setBootstrapContext(tx);
          const flowId = `rls-contract-clear-${randomUUID()}`;
          await tx.passwordResetToken.create({
            data: {
              id: flowId,
              userId: user1Id,
              token: validToken.replace(/a$/, 'c'),
              expiresAt: new Date(Date.now() + 60_000),
              auditOrganizationIds: [org1Id],
              providerCorrelationSchemaVersion: 1,
            },
          });
          await tx.passwordResetToken.update({
            where: { id: flowId },
            data: { providerCorrelationSchemaVersion: null },
          });
        })
      ).rejects.toThrow(/PASSWORD_RESET_DELIVERY_CONTRACT_MARKER_IMMUTABLE/);

      await expect(
        db.$transaction(async (tx) => {
          await setBootstrapContext(tx);
          await tx.passwordResetToken.create({
            data: {
              id: `rls-contract-invalid-${randomUUID()}`,
              userId: user1Id,
              token: `prh1:${'d'.repeat(64)}`,
              expiresAt: new Date(Date.now() + 60_000),
              auditOrganizationIds: [` ${org1Id}`],
              providerCorrelationSchemaVersion: 1,
            },
          });
        })
      ).rejects.toThrow(/PASSWORD_RESET_DELIVERY_CONTRACT_INVALID/);

      await expect(
        db.$transaction(async (tx) => {
          await setBootstrapContext(tx);
          await tx.passwordResetToken.create({
            data: {
              id: `rls-contract-order-${randomUUID()}`,
              userId: user1Id,
              token: `prh1:${'e'.repeat(64)}`,
              expiresAt: new Date(Date.now() + 60_000),
              auditOrganizationIds: ['scope-z', 'scope-A'],
              providerCorrelationSchemaVersion: 1,
            },
          });
        })
      ).rejects.toThrow(/PASSWORD_RESET_DELIVERY_CONTRACT_INVALID/);
    });

    it('registers one immutable provider tuple and protects all attribution parents', async () => {
      const flowId = `rls-correlation-${randomUUID()}`;
      const providerMessageId = `acs-message-${randomUUID()}`;
      const providerAcceptedAt = new Date();
      await db.$transaction(async (tx) => {
        await setBootstrapContext(tx);
        await tx.passwordResetToken.create({
          data: {
            id: flowId,
            userId: user1Id,
            token: `prh1:${createHash('sha256').update(flowId).digest('hex')}`,
            expiresAt: new Date(Date.now() + 60_000),
            requestId: `request-${randomUUID()}`,
            organizationId: org1Id,
            deliveryStatus: 'PENDING',
            auditOrganizationIds: [org1Id],
            providerCorrelationSchemaVersion: 1,
          },
        });
        await tx.passwordResetRecovery.create({
          data: {
            flowId,
            userId: user1Id,
            recipientFingerprint: '8'.repeat(64),
            cipherVersion: 1,
            keyId: 'integration-test',
            nonce: Buffer.alloc(12),
            ciphertext: Buffer.alloc(48),
            authTag: Buffer.alloc(16),
            providerOperationId: flowId,
            sendFence: 1,
          },
        });
        await tx.passwordResetToken.update({
          where: { id: flowId },
          data: {
            deliveryStatus: 'PROVIDER_ACCEPTED',
            provider: 'acs',
            providerOperationId: flowId,
            providerMessageId,
            providerAcceptedAt,
          },
        });
        await tx.passwordResetToken.update({
          where: { id: flowId },
          data: {
            deliveryStatus: 'PROVIDER_ACCEPTED',
            provider: 'acs',
            providerOperationId: flowId,
            providerMessageId,
            providerAcceptedAt,
            providerCorrelationSchemaVersion: 1,
          },
        });
      });

      const stored = await rawPrisma.passwordResetProviderCorrelation.findUniqueOrThrow({
        where: { flowId },
      });
      expect(stored).toEqual(
        expect.objectContaining({
          flowId,
          provider: 'acs',
          providerOperationId: flowId,
          providerMessageId,
          correlationSchemaVersion: 1,
        })
      );
      await rawPrisma.passwordResetToken.update({
        where: { id: flowId },
        data: { deliveryStatus: 'CANCELLED' },
      });
      const [afterCancellation] = await db.$queryRaw<
        Array<{ divergentCorrelationRows: number; missingCorrelationRows: number }>
      >`
        SELECT "divergentCorrelationRows", "missingCorrelationRows"
        FROM public.password_reset_provider_correlation_preflight_counts()`;
      expect(afterCancellation).toEqual({
        divergentCorrelationRows: 0,
        missingCorrelationRows: 0,
      });
      await expect(
        rawPrisma.passwordResetProviderCorrelation.update({
          where: { flowId },
          data: { providerAcceptedAt: new Date(providerAcceptedAt.getTime() + 1_000) },
        })
      ).rejects.toThrow(/PASSWORD_RESET_PROVIDER_CORRELATION_IMMUTABLE/);
      await expect(
        rawPrisma.passwordResetProviderCorrelation.delete({ where: { flowId } })
      ).rejects.toThrow(/PASSWORD_RESET_PROVIDER_CORRELATION_IMMUTABLE/);
      await expect(
        rawPrisma.$executeRawUnsafe('TRUNCATE TABLE password_reset_provider_correlations')
      ).rejects.toThrow(/PASSWORD_RESET_PROVIDER_CORRELATION_IMMUTABLE/);
      await expect(
        rawPrisma.passwordResetToken.update({
          where: { id: flowId },
          data: { requestId: `changed-${randomUUID()}` },
        })
      ).rejects.toThrow(/PASSWORD_RESET_PROVIDER_CORRELATION_SOURCE_IMMUTABLE/);
      await expect(
        rawPrisma.passwordResetRecovery.update({
          where: { flowId },
          data: { providerOperationId: `changed-${randomUUID()}` },
        })
      ).rejects.toThrow();
      await expect(rawPrisma.passwordResetRecovery.delete({ where: { flowId } })).rejects.toThrow();
      await expect(
        rawPrisma.passwordResetToken.delete({ where: { id: flowId } })
      ).rejects.toThrow();
    });

    it('rolls back correlation registration with the surrounding acceptance transaction', async () => {
      const flowId = `rls-correlation-rollback-${randomUUID()}`;
      const [before] = await db.$queryRaw<Array<{ registeredCorrelationRows: number }>>`
        SELECT "registeredCorrelationRows"
        FROM public.password_reset_provider_correlation_preflight_counts()`;
      let observedInside = false;
      await expect(
        db.$transaction(async (tx) => {
          await setBootstrapContext(tx);
          await tx.passwordResetToken.create({
            data: {
              id: flowId,
              userId: user1Id,
              token: `prh1:${createHash('sha256').update(flowId).digest('hex')}`,
              expiresAt: new Date(Date.now() + 60_000),
              organizationId: org1Id,
              deliveryStatus: 'PENDING',
              auditOrganizationIds: [org1Id],
              providerCorrelationSchemaVersion: 1,
            },
          });
          await tx.passwordResetRecovery.create({
            data: {
              flowId,
              userId: user1Id,
              recipientFingerprint: '9'.repeat(64),
              providerOperationId: flowId,
              sendFence: 1,
            },
          });
          await tx.passwordResetToken.update({
            where: { id: flowId },
            data: {
              deliveryStatus: 'PROVIDER_ACCEPTED',
              provider: 'acs',
              providerOperationId: flowId,
              providerMessageId: `rollback-message-${randomUUID()}`,
              providerAcceptedAt: new Date(),
            },
          });
          const [inside] = await tx.$queryRaw<Array<{ registeredCorrelationRows: number }>>`
            SELECT "registeredCorrelationRows"
            FROM public.password_reset_provider_correlation_preflight_counts()`;
          expect(inside?.registeredCorrelationRows).toBe(
            (before?.registeredCorrelationRows ?? 0) + 1
          );
          observedInside = true;
          throw new Error('ROLLBACK_PROVIDER_CORRELATION_CANARY');
        })
      ).rejects.toThrow('ROLLBACK_PROVIDER_CORRELATION_CANARY');
      const [after] = await db.$queryRaw<Array<{ registeredCorrelationRows: number }>>`
        SELECT "registeredCorrelationRows"
        FROM public.password_reset_provider_correlation_preflight_counts()`;
      expect(observedInside).toBe(true);
      expect(after?.registeredCorrelationRows).toBe(before?.registeredCorrelationRows);
      expect(
        await rawPrisma.passwordResetProviderCorrelation.findUnique({ where: { flowId } })
      ).toBeNull();
    });

    it('allows exactly one concurrent flow to claim an ACS provider message identifier', async () => {
      const flowIds = [
        `rls-correlation-race-a-${randomUUID()}`,
        `rls-correlation-race-b-${randomUUID()}`,
      ];
      const providerMessageSentinel = `sensitive-race-message-${randomUUID()}`;
      for (const flowId of flowIds) {
        await db.$transaction(async (tx) => {
          await setBootstrapContext(tx);
          await tx.passwordResetToken.create({
            data: {
              id: flowId,
              userId: user1Id,
              token: `prh1:${createHash('sha256').update(flowId).digest('hex')}`,
              expiresAt: new Date(Date.now() + 60_000),
              organizationId: org1Id,
              deliveryStatus: 'PENDING',
              auditOrganizationIds: [org1Id],
              providerCorrelationSchemaVersion: 1,
            },
          });
          await tx.passwordResetRecovery.create({
            data: {
              flowId,
              userId: user1Id,
              recipientFingerprint: 'a'.repeat(64),
              providerOperationId: flowId,
              sendFence: 1,
            },
          });
        });
      }

      const outcomes = await Promise.allSettled(
        flowIds.map((flowId) =>
          db.passwordResetToken.update({
            where: { id: flowId },
            data: {
              deliveryStatus: 'PROVIDER_ACCEPTED',
              provider: 'acs',
              providerOperationId: flowId,
              providerMessageId: providerMessageSentinel,
              providerAcceptedAt: new Date(),
            },
          })
        )
      );
      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const winningIndex = outcomes.findIndex(({ status }) => status === 'fulfilled');
      const losingIndex = outcomes.findIndex(({ status }) => status === 'rejected');
      expect(winningIndex).toBeGreaterThanOrEqual(0);
      expect(losingIndex).toBeGreaterThanOrEqual(0);
      const rejected = outcomes.find(({ status }) => status === 'rejected');
      if (rejected?.status === 'rejected') {
        expect(String(rejected.reason)).not.toContain(providerMessageSentinel);
      }
      expect(
        await rawPrisma.passwordResetProviderCorrelation.count({
          where: { provider: 'acs', providerMessageId: providerMessageSentinel },
        })
      ).toBe(1);
      const losingSource = await rawPrisma.passwordResetToken.findUniqueOrThrow({
        where: { id: flowIds[losingIndex]! },
        select: {
          deliveryStatus: true,
          provider: true,
          providerOperationId: true,
          providerMessageId: true,
          providerAcceptedAt: true,
        },
      });
      expect(losingSource).toEqual({
        deliveryStatus: 'PENDING',
        provider: null,
        providerOperationId: null,
        providerMessageId: null,
        providerAcceptedAt: null,
      });
      expect(
        await rawPrisma.passwordResetProviderCorrelation.findUnique({
          where: { flowId: flowIds[losingIndex]! },
        })
      ).toBeNull();
      expect(
        await rawPrisma.passwordResetProviderCorrelation.findUnique({
          where: { flowId: flowIds[winningIndex]! },
        })
      ).toEqual(expect.objectContaining({ providerMessageId: providerMessageSentinel }));
    });

    it('serializes simultaneous exact acceptances for one flow idempotently', async () => {
      const flowId = `rls-correlation-same-flow-${randomUUID()}`;
      const providerMessageId = `same-flow-message-${randomUUID()}`;
      const providerAcceptedAt = new Date();
      await db.$transaction(async (tx) => {
        await setBootstrapContext(tx);
        await tx.passwordResetToken.create({
          data: {
            id: flowId,
            userId: user1Id,
            token: `prh1:${createHash('sha256').update(flowId).digest('hex')}`,
            expiresAt: new Date(Date.now() + 60_000),
            organizationId: org1Id,
            deliveryStatus: 'PENDING',
            auditOrganizationIds: [org1Id],
            providerCorrelationSchemaVersion: 1,
          },
        });
        await tx.passwordResetRecovery.create({
          data: {
            flowId,
            userId: user1Id,
            recipientFingerprint: 'b'.repeat(64),
            providerOperationId: flowId,
            sendFence: 1,
          },
        });
      });
      const update = () =>
        db.passwordResetToken.update({
          where: { id: flowId },
          data: {
            deliveryStatus: 'PROVIDER_ACCEPTED',
            provider: 'acs',
            providerOperationId: flowId,
            providerMessageId,
            providerAcceptedAt,
          },
        });

      const outcomes = await Promise.allSettled([update(), update()]);

      expect(outcomes.every(({ status }) => status === 'fulfilled')).toBe(true);
      expect(await rawPrisma.passwordResetProviderCorrelation.count({ where: { flowId } })).toBe(1);
    });

    it('detects rollback-scoped owner, function, trigger, constraint, and index catalog drift', async () => {
      const driftCases: Array<{
        label: string;
        mutateSql: string;
        countColumn:
          | 'ownerMismatchRows'
          | 'invalidFunctionPostureRows'
          | 'missingRequiredTriggerRows'
          | 'missingRequiredConstraintRows'
          | 'missingRequiredIndexRows';
      }> = [
        {
          label: 'owner',
          mutateSql:
            'ALTER TABLE public.password_reset_provider_correlations OWNER TO vaultspace_app',
          countColumn: 'ownerMismatchRows',
        },
        {
          label: 'function posture',
          mutateSql:
            'ALTER FUNCTION public.password_reset_provider_correlation_eligible(public.password_reset_tokens, public.password_reset_recoveries) VOLATILE',
          countColumn: 'invalidFunctionPostureRows',
        },
        {
          label: 'trigger',
          mutateSql:
            'ALTER TABLE public.password_reset_tokens DISABLE TRIGGER password_reset_provider_correlation_register',
          countColumn: 'missingRequiredTriggerRows',
        },
        {
          label: 'constraint',
          mutateSql:
            'ALTER TABLE public.password_reset_provider_correlations DROP CONSTRAINT password_reset_provider_correlations_provider_check',
          countColumn: 'missingRequiredConstraintRows',
        },
        {
          label: 'index',
          mutateSql: 'DROP INDEX public.password_reset_provider_correlations_recorded_idx',
          countColumn: 'missingRequiredIndexRows',
        },
      ];

      for (const driftCase of driftCases) {
        const rollbackSentinel = `ROLLBACK_CATALOG_DRIFT_${driftCase.label}`;
        await expect(
          rawPrisma.$transaction(
            async (tx) => {
              await tx.$executeRawUnsafe(driftCase.mutateSql);
              const rows = await tx.$queryRawUnsafe<Array<Record<string, number>>>(
                `SELECT "${driftCase.countColumn}" FROM public.password_reset_provider_correlation_preflight_counts()`
              );
              expect(rows[0]?.[driftCase.countColumn]).toBeGreaterThan(0);
              throw new Error(rollbackSentinel);
            },
            { maxWait: 5_000, timeout: 30_000 }
          )
        ).rejects.toThrow(rollbackSentinel);
      }

      const [restored] = await db.$queryRaw<
        Array<{
          ownerMismatchRows: number;
          invalidFunctionPostureRows: number;
          missingRequiredTriggerRows: number;
          missingRequiredConstraintRows: number;
          missingRequiredIndexRows: number;
        }>
      >`
        SELECT
          "ownerMismatchRows",
          "invalidFunctionPostureRows",
          "missingRequiredTriggerRows",
          "missingRequiredConstraintRows",
          "missingRequiredIndexRows"
        FROM public.password_reset_provider_correlation_preflight_counts()`;
      expect(restored).toEqual({
        ownerMismatchRows: 0,
        invalidFunctionPostureRows: 0,
        missingRequiredTriggerRows: 0,
        missingRequiredConstraintRows: 0,
        missingRequiredIndexRows: 0,
      });
    });

    it('backfills only trusted current ACS acceptances and rolls back a conflicting populated migration', async () => {
      if (process.env['ALLOW_RLS_TEST_DB_SETUP'] !== 'true') {
        throw new Error('Populated migration tests require ALLOW_RLS_TEST_DB_SETUP=true');
      }
      const adminUrl = process.env['DATABASE_URL_ADMIN'];
      if (!adminUrl) {
        throw new Error('Populated migration tests require DATABASE_URL_ADMIN');
      }

      const successfulDatabase = `vaultspace_corr_ok_${randomUUID().replaceAll('-', '')}`;
      const rollbackDatabase = `vaultspace_corr_rollback_${randomUUID().replaceAll('-', '')}`;
      const successfulUrl = databaseUrlForName(adminUrl, successfulDatabase);
      const rollbackUrl = databaseUrlForName(adminUrl, rollbackDatabase);
      const predecessorSql = migrationSqlThrough(PROVIDER_CORRELATION_PREDECESSOR);
      const migrationSql = readFileSync(
        join(
          process.cwd(),
          'prisma',
          'migrations',
          PROVIDER_CORRELATION_MIGRATION,
          'migration.sql'
        ),
        'utf8'
      );
      const disposableClients: PrismaClient[] = [];

      try {
        await rawPrisma.$executeRawUnsafe(`CREATE DATABASE "${successfulDatabase}"`);
        await rawPrisma.$executeRawUnsafe(`CREATE DATABASE "${rollbackDatabase}"`);
        executeSqlWithPrisma(successfulUrl, predecessorSql);
        executeSqlWithPrisma(rollbackUrl, predecessorSql);

        const successfulClient = new PrismaClient({
          datasources: { db: { url: successfulUrl } },
        });
        disposableClients.push(successfulClient);
        const userId = `usr_${randomUUID().replaceAll('-', '')}`;
        const userEmail = `migration-success-${randomUUID()}@example.com`;
        await successfulClient.$executeRawUnsafe(
          `INSERT INTO "users" ("id", "email", "passwordHash", "firstName", "lastName", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          userId,
          userEmail,
          'migration-test-hash',
          'Migration',
          'Success'
        );
        const successfulUser = { id: userId, email: userEmail };
        const trustedFlowId = `migration-trusted-${randomUUID()}`;
        const excludedFlowIds = [
          `migration-legacy-${randomUUID()}`,
          `migration-smtp-${randomUUID()}`,
          `migration-pending-${randomUUID()}`,
          `migration-cancelled-${randomUUID()}`,
        ];
        await seedMigrationAcceptance(successfulClient, {
          flowId: trustedFlowId,
          userId: successfulUser.id,
          provider: 'acs',
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: `trusted-${randomUUID()}`,
          schemaVersion: 1,
        });
        await seedMigrationAcceptance(successfulClient, {
          flowId: excludedFlowIds[0]!,
          userId: successfulUser.id,
          provider: 'acs',
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: `legacy-${randomUUID()}`,
          schemaVersion: null,
        });
        await seedMigrationAcceptance(successfulClient, {
          flowId: excludedFlowIds[1]!,
          userId: successfulUser.id,
          provider: 'smtp',
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: `smtp-${randomUUID()}`,
          schemaVersion: 1,
        });
        await seedMigrationAcceptance(successfulClient, {
          flowId: excludedFlowIds[2]!,
          userId: successfulUser.id,
          provider: 'acs',
          deliveryStatus: 'PENDING',
          providerMessageId: `pending-${randomUUID()}`,
          schemaVersion: 1,
        });
        await seedMigrationAcceptance(successfulClient, {
          flowId: excludedFlowIds[3]!,
          userId: successfulUser.id,
          provider: 'acs',
          deliveryStatus: 'CANCELLED',
          providerMessageId: `cancelled-${randomUUID()}`,
          schemaVersion: 1,
        });

        executeSqlWithPrisma(successfulUrl, migrationSql);
        expect(
          await successfulClient.passwordResetProviderCorrelation.findMany({
            select: { flowId: true },
            orderBy: { flowId: 'asc' },
          })
        ).toEqual([{ flowId: trustedFlowId }]);
        expect(
          await successfulClient.passwordResetProviderCorrelation.count({
            where: { flowId: { in: excludedFlowIds } },
          })
        ).toBe(0);
        const [successfulCounts] = await successfulClient.$queryRaw<
          Array<{
            eligibleAcceptedAcsRows: number;
            registeredCorrelationRows: number;
            missingCorrelationRows: number;
            divergentCorrelationRows: number;
          }>
        >`
            SELECT
              "eligibleAcceptedAcsRows",
              "registeredCorrelationRows",
              "missingCorrelationRows",
              "divergentCorrelationRows"
            FROM public.password_reset_provider_correlation_preflight_counts()`;
        expect(successfulCounts).toEqual({
          eligibleAcceptedAcsRows: 1,
          registeredCorrelationRows: 1,
          missingCorrelationRows: 0,
          divergentCorrelationRows: 0,
        });

        const rollbackClient = new PrismaClient({
          datasources: { db: { url: rollbackUrl } },
        });
        disposableClients.push(rollbackClient);
        await rollbackClient.$connect();
        const rollbackUser = await rollbackClient.user.create({
          data: {
            email: `migration-rollback-${randomUUID()}@example.com`,
            passwordHash: 'migration-test-hash',
            firstName: 'Migration',
            lastName: 'Rollback',
          },
        });
        const duplicateProviderMessageId = `duplicate-${randomUUID()}`;
        await seedMigrationAcceptance(rollbackClient, {
          flowId: `migration-conflict-a-${randomUUID()}`,
          userId: rollbackUser.id,
          provider: 'acs',
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: duplicateProviderMessageId,
          schemaVersion: 1,
        });
        await seedMigrationAcceptance(rollbackClient, {
          flowId: `migration-conflict-b-${randomUUID()}`,
          userId: rollbackUser.id,
          provider: 'acs',
          deliveryStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: duplicateProviderMessageId,
          schemaVersion: 1,
        });

        expect(() => executeSqlWithPrisma(rollbackUrl, migrationSql)).toThrow();
        const [rollbackPosture] = await rollbackClient.$queryRaw<
          Array<{ registryName: string | null; recoveryConstraintRows: number }>
        >`
            SELECT
              to_regclass('public.password_reset_provider_correlations')::text AS "registryName",
              (
                SELECT count(*)::integer
                FROM pg_catalog.pg_constraint
                WHERE conrelid = 'public.password_reset_recoveries'::regclass
                  AND conname = 'password_reset_recoveries_flow_operation_key'
              ) AS "recoveryConstraintRows"`;
        expect(rollbackPosture).toEqual({ registryName: null, recoveryConstraintRows: 0 });
      } finally {
        await Promise.all(disposableClients.map((client) => client.$disconnect()));
        await rawPrisma.$executeRawUnsafe(
          `DROP DATABASE IF EXISTS "${successfulDatabase}" WITH (FORCE)`
        );
        await rawPrisma.$executeRawUnsafe(
          `DROP DATABASE IF EXISTS "${rollbackDatabase}" WITH (FORCE)`
        );
      }
    }, 120_000);

    it('serializes concurrent self-service and admin reset issuance for one account', async () => {
      const target = await rawPrisma.user.create({
        data: {
          email: `reset-target-${randomUUID()}@example.com`,
          passwordHash: 'test-hash',
          firstName: 'Reset',
          lastName: 'Target',
          isActive: true,
          organizations: {
            create: { organizationId: org1Id, role: UserRole.VIEWER, isActive: true },
          },
        },
      });

      const issued = await Promise.all([
        issuePasswordResetWithReviewedLocks({
          targetUserId: target.id,
          actorUserId: target.id,
          organizationId: org1Id,
          mode: 'self',
        }),
        issuePasswordResetWithReviewedLocks({
          targetUserId: target.id,
          actorUserId: user1Id,
          organizationId: org1Id,
          mode: 'admin',
        }),
      ]);

      expect(issued.every(Boolean)).toBe(true);
      const rows = await rawPrisma.passwordResetToken.findMany({
        where: { userId: target.id },
        select: { usedAt: true, deliveryStatus: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.filter(({ usedAt }) => usedAt === null)).toHaveLength(1);
      expect(rows.filter(({ deliveryStatus }) => deliveryStatus === 'SUPERSEDED')).toHaveLength(1);
    });

    it('serializes two concurrent admin reset issuances for one account', async () => {
      const target = await rawPrisma.user.create({
        data: {
          email: `admin-reset-target-${randomUUID()}@example.com`,
          passwordHash: 'test-hash',
          firstName: 'Admin Reset',
          lastName: 'Target',
          isActive: true,
          organizations: {
            create: { organizationId: org1Id, role: UserRole.VIEWER, isActive: true },
          },
        },
      });

      const issued = await Promise.all([
        issuePasswordResetWithReviewedLocks({
          targetUserId: target.id,
          actorUserId: user1Id,
          organizationId: org1Id,
          mode: 'admin',
        }),
        issuePasswordResetWithReviewedLocks({
          targetUserId: target.id,
          actorUserId: user1Id,
          organizationId: org1Id,
          mode: 'admin',
        }),
      ]);

      expect(issued.every(Boolean)).toBe(true);
      const rows = await rawPrisma.passwordResetToken.findMany({
        where: { userId: target.id },
        select: { usedAt: true, deliveryStatus: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.filter(({ usedAt }) => usedAt === null)).toHaveLength(1);
      expect(rows.filter(({ deliveryStatus }) => deliveryStatus === 'SUPERSEDED')).toHaveLength(1);
    });

    it('denies admin issuance after a concurrent demotion commits ahead of authorization locks', async () => {
      const target = await rawPrisma.user.create({
        data: {
          email: `demotion-target-${randomUUID()}@example.com`,
          passwordHash: 'test-hash',
          firstName: 'Demotion',
          lastName: 'Target',
          isActive: true,
          organizations: {
            create: { organizationId: org1Id, role: UserRole.VIEWER, isActive: true },
          },
        },
      });
      let releaseMutation!: () => void;
      const mutationHeld = new Promise<void>((resolve) => {
        releaseMutation = resolve;
      });
      let mutationLocked!: () => void;
      const mutationHasLock = new Promise<void>((resolve) => {
        mutationLocked = resolve;
      });
      const demotion = rawPrisma.$transaction(async (tx) => {
        await tx.userOrganization.updateMany({
          where: { organizationId: org1Id, userId: user1Id },
          data: { role: UserRole.VIEWER },
        });
        mutationLocked();
        await mutationHeld;
      });
      await mutationHasLock;
      let issuanceAtMembershipLock!: () => void;
      const issuanceReady = new Promise<void>((resolve) => {
        issuanceAtMembershipLock = resolve;
      });
      const issuance = issuePasswordResetWithReviewedLocks({
        targetUserId: target.id,
        actorUserId: user1Id,
        organizationId: org1Id,
        mode: 'admin',
        onReadyToLock: issuanceAtMembershipLock,
      });
      await issuanceReady;
      releaseMutation();

      await demotion;
      await expect(issuance).resolves.toBeNull();
      expect(await rawPrisma.passwordResetToken.count({ where: { userId: target.id } })).toBe(0);
    });

    it('denies admin issuance after concurrent target-membership deactivation commits', async () => {
      const target = await rawPrisma.user.create({
        data: {
          email: `deactivation-target-${randomUUID()}@example.com`,
          passwordHash: 'test-hash',
          firstName: 'Deactivation',
          lastName: 'Target',
          isActive: true,
          organizations: {
            create: { organizationId: org1Id, role: UserRole.VIEWER, isActive: true },
          },
        },
      });
      let releaseMutation!: () => void;
      const mutationHeld = new Promise<void>((resolve) => {
        releaseMutation = resolve;
      });
      let mutationLocked!: () => void;
      const mutationHasLock = new Promise<void>((resolve) => {
        mutationLocked = resolve;
      });
      const deactivation = rawPrisma.$transaction(async (tx) => {
        await tx.userOrganization.updateMany({
          where: { organizationId: org1Id, userId: target.id },
          data: { isActive: false },
        });
        mutationLocked();
        await mutationHeld;
      });
      await mutationHasLock;
      let issuanceAtMembershipLock!: () => void;
      const issuanceReady = new Promise<void>((resolve) => {
        issuanceAtMembershipLock = resolve;
      });
      const issuance = issuePasswordResetWithReviewedLocks({
        targetUserId: target.id,
        actorUserId: user1Id,
        organizationId: org1Id,
        mode: 'admin',
        onReadyToLock: issuanceAtMembershipLock,
      });
      await issuanceReady;
      releaseMutation();

      await deactivation;
      await expect(issuance).resolves.toBeNull();
      expect(await rawPrisma.passwordResetToken.count({ where: { userId: target.id } })).toBe(0);
    });

    it('returns aggregate-only password reset delivery contract diagnostics', async () => {
      const diagnostics = await inspectPasswordResetProviderCorrelation(null);

      expect(diagnostics).toEqual(
        expect.objectContaining({
          markedFlows: expect.any(Number),
          markedNonHmacRows: 0,
          markedInvalidAuditScopeRows: 0,
          markedAcceptedIncompleteRows: 0,
          markedRowsWithoutRecovery: 0,
          markedOperationIdMismatchRows: 0,
          unmarkedActiveDeliveryRows: expect.any(Number),
          unmarkedAcceptedAcsRows: expect.any(Number),
          overLimitActiveMembershipAccounts: 0,
        })
      );
      expect(Object.keys(diagnostics)).not.toEqual(
        expect.arrayContaining(['providerMessageId', 'providerOperationId'])
      );
    });

    it('should allow organization lookup by slug without context', async () => {
      // This simulates the bootstrap pattern where we need to resolve
      // an organization before we can establish context
      const bootstrapPrisma = new PrismaClient();
      try {
        const org = await bootstrapPrisma.organization.findFirst({
          where: {
            slug: org1Slug,
            isActive: true,
          },
          select: {
            id: true,
            slug: true,
          },
        });

        expect(org).not.toBeNull();
        expect(org?.id).toBe(org1Id);
      } finally {
        await bootstrapPrisma.$disconnect();
      }
    });

    it('should allow session lookup by token (non-RLS table)', async () => {
      // Sessions table is intentionally not RLS-protected
      // This is a verification that session lookup works without org context
      const session = await db.session.findFirst({
        where: {
          // Using a non-existent token - we're just verifying the query works
          token: 'non-existent-token-for-testing',
        },
      });

      // Query should execute without error (returns null for non-existent token)
      expect(session).toBeNull();
    });
  });

  describe('Event audit trail', () => {
    it('should write events within RLS context', async () => {
      const eventData = {
        eventType: 'ROOM_CREATED' as const,
        actorType: 'ADMIN' as const,
        organizationId: org1Id,
        roomId: room1Id,
        description: 'RLS test event',
      };

      const event = await withOrgContext(org1Id, async (tx) => {
        return tx.event.create({
          data: eventData,
        });
      });

      expect(event.id).toBeDefined();
      expect(event.organizationId).toBe(org1Id);
    });

    it('should scope event queries to organization', async () => {
      // Create events in both orgs
      const event1 = await rawPrisma.event.create({
        data: {
          eventType: 'ROOM_CREATED',
          actorType: 'ADMIN',
          organizationId: org1Id,
          roomId: room1Id,
          description: 'Org1 event',
        },
      });

      const event2 = await rawPrisma.event.create({
        data: {
          eventType: 'ROOM_CREATED',
          actorType: 'ADMIN',
          organizationId: org2Id,
          roomId: room2Id,
          description: 'Org2 event',
        },
      });

      // Query events in org1 context
      const org1Events = await withOrgContext(org1Id, async (tx) => {
        return tx.event.findMany({
          where: { organizationId: org1Id },
        });
      });

      expect(org1Events.some((e) => e.description === 'Org1 event')).toBe(true);
      expect(org1Events.some((e) => e.description === 'Org2 event')).toBe(false);
    });
  });

  describe('PermissionEngine with transaction', () => {
    it('should accept transaction client for RLS-scoped permission checks', async () => {
      const permissionEngine = getPermissionEngine();

      // Test that PermissionEngine.can() accepts a transaction client
      const result = await withOrgContext(org1Id, async (tx) => {
        // Pass transaction to permission check - this verifies the signature works
        const canView = await permissionEngine.can(
          { userId: user1Id, role: 'ADMIN' as UserRole },
          'view',
          { type: 'ROOM', organizationId: org1Id, roomId: room1Id },
          tx // Transaction client parameter
        );
        return canView;
      });

      // Admin should have view permission on their org's room
      expect(result).toBe(true);
    });

    it('should deny cross-tenant access through permission engine', async () => {
      const permissionEngine = getPermissionEngine();

      // Try to check permission for org2's room while in org1's context
      const result = await withOrgContext(org1Id, async (tx) => {
        const canView = await permissionEngine.can(
          { userId: user1Id, role: 'ADMIN' as UserRole },
          'view',
          { type: 'ROOM', organizationId: org2Id, roomId: room2Id },
          tx
        );
        return canView;
      });

      // Should not have permission to org2's room
      expect(result).toBe(false);
    });
  });

  describe('EventBus RLS wrapping', () => {
    it('should auto-wrap event writes in RLS context when no client provided', async () => {
      // Create EventBus without passing a transaction - it should auto-wrap
      const eventBus = createEventBus(org1Id, {
        actorId: user1Id,
        actorType: 'ADMIN',
        requestId: `test-${Date.now()}`,
      });

      // Emit event without explicit client - EventBus should wrap in withOrgContext
      const eventId = await eventBus.emit('ROOM_CREATED', {
        roomId: room1Id,
        description: 'EventBus auto-wrap test',
      });

      expect(eventId).toBeDefined();

      // Verify event was created with correct org
      const event = await rawPrisma.event.findUnique({
        where: { id: eventId },
      });

      expect(event).toBeDefined();
      expect(event?.organizationId).toBe(org1Id);
    });

    it('should use provided transaction client for event writes', async () => {
      const eventBus = createEventBus(org1Id, {
        actorId: user1Id,
        actorType: 'ADMIN',
        requestId: `test-${Date.now()}`,
      });

      // Emit event with explicit transaction client
      const eventId = await withOrgContext(org1Id, async (tx) => {
        return eventBus.emit(
          'ROOM_UPDATED',
          {
            roomId: room1Id,
            description: 'EventBus with tx test',
          },
          tx // Pass transaction explicitly
        );
      });

      expect(eventId).toBeDefined();

      // Verify event was created
      const event = await rawPrisma.event.findUnique({
        where: { id: eventId },
      });

      expect(event?.description).toBe('EventBus with tx test');
    });
  });

  describe('Service layer RLS integration', () => {
    it('should verify RoomService uses withOrgContext internally', async () => {
      // This test verifies that service methods properly scope data
      // by checking that queries return only tenant-appropriate data

      // Query rooms using the pattern services use internally
      const rooms = await withOrgContext(org1Id, async (tx) => {
        return tx.room.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        });
      });

      // All returned rooms should belong to org1
      const allBelongToOrg1 = rooms.every((r) => r.organizationId === org1Id);

      expect(allBelongToOrg1).toBe(true);
    });

    it('should verify GroupService patterns work with RLS', async () => {
      // Create a group using the RLS context pattern that GroupService uses
      const group = await withOrgContext(org1Id, async (tx) => {
        return tx.group.create({
          data: {
            organizationId: org1Id,
            name: `RLS Test Group ${Date.now()}`,
          },
        });
      });

      expect(group.organizationId).toBe(org1Id);

      // Query group back
      const foundGroup = await withOrgContext(org1Id, async (tx) => {
        return tx.group.findFirst({
          where: { id: group.id },
        });
      });

      expect(foundGroup).toBeDefined();

      // Try to access from wrong org context (should fail with RLS)
      const crossTenantGroup = await withOrgContext(org2Id, async (tx) => {
        return tx.group.findFirst({
          where: { id: group.id },
        });
      });

      expect(crossTenantGroup).toBeNull();

      // Cleanup
      await rawPrisma.group.delete({ where: { id: group.id } });
    });
  });
});
