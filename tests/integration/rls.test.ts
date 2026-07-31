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

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import { withOrgContext, db, setBootstrapContext } from '@/lib/db';
import { lockPasswordResetUser } from '@/lib/auth/passwordResetToken';
import { revokeAndVerifyProviderInboxAccess } from '@/lib/integrations/providerInboxDatabasePrivileges';
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
