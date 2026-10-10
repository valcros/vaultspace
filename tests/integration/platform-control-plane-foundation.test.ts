/**
 * Database-backed release gate for the inert platform-control foundation.
 * It runs after migrations, RLS policy application, and the broad-grant repair
 * replay in the RLS CI job. No Brightside or shared infrastructure is used.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemRoomTemplateService } from '../../src/services/SystemRoomTemplateService';

const admin = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'] } },
});
const runtime = new PrismaClient();

const protectedTables = [
  'platform_sessions',
  'platform_capability_grants',
  'platform_audit_events',
  'account_links',
  'account_switch_sessions',
];

describe('platform control-plane foundation', () => {
  it('keeps every platform table default-deny after the runtime broad-grant repair', async () => {
    const posture = await admin.$queryRawUnsafe<
      Array<{
        relname: string;
        rowsecurity: boolean;
        forcerowsecurity: boolean;
        policy_count: bigint;
        runtime_select: boolean;
        runtime_insert: boolean;
        runtime_update: boolean;
        runtime_delete: boolean;
        runtime_truncate: boolean;
        runtime_column_privilege: boolean;
      }>
    >(`
      SELECT class_meta.relname,
             class_meta.relrowsecurity AS rowsecurity,
             class_meta.relforcerowsecurity AS forcerowsecurity,
             (SELECT count(*) FROM pg_policies policy
                WHERE policy.schemaname = 'public' AND policy.tablename = class_meta.relname) AS policy_count,
             has_table_privilege('vaultspace_app', class_meta.oid, 'SELECT') AS runtime_select,
             has_table_privilege('vaultspace_app', class_meta.oid, 'INSERT') AS runtime_insert,
             has_table_privilege('vaultspace_app', class_meta.oid, 'UPDATE') AS runtime_update,
             has_table_privilege('vaultspace_app', class_meta.oid, 'DELETE') AS runtime_delete,
             has_table_privilege('vaultspace_app', class_meta.oid, 'TRUNCATE') AS runtime_truncate,
             has_any_column_privilege('vaultspace_app', class_meta.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
               AS runtime_column_privilege
      FROM pg_class class_meta
      WHERE class_meta.relnamespace = 'public'::regnamespace
        AND class_meta.relname IN (
          'platform_sessions', 'platform_capability_grants', 'platform_audit_events',
          'account_links', 'account_switch_sessions'
        )
      ORDER BY class_meta.relname
    `);

    expect(posture).toHaveLength(protectedTables.length);
    for (const table of posture) {
      expect(table.rowsecurity).toBe(true);
      expect(table.forcerowsecurity).toBe(true);
      expect(Number(table.policy_count)).toBe(0);
      expect(table.runtime_select).toBe(false);
      expect(table.runtime_insert).toBe(false);
      expect(table.runtime_update).toBe(false);
      expect(table.runtime_delete).toBe(false);
      expect(table.runtime_truncate).toBe(false);
      expect(table.runtime_column_privilege).toBe(false);
    }
    const [sequenceAccess] = await admin.$queryRawUnsafe<Array<{ usable: boolean }>>(
      `SELECT has_sequence_privilege('vaultspace_app',
        'public.platform_audit_events_sequence_seq', 'USAGE')
        OR has_sequence_privilege('vaultspace_app',
          'public.platform_audit_events_sequence_seq', 'SELECT')
        OR has_sequence_privilege('vaultspace_app',
          'public.platform_audit_events_sequence_seq', 'UPDATE') AS usable`
    );
    expect(sequenceAccess?.usable).toBe(false);
  });

  it('denies direct ordinary-runtime SQL against every protected table', async () => {
    for (const table of protectedTables) {
      await expect(
        runtime.$queryRawUnsafe(`SELECT * FROM public.${table} LIMIT 1`)
      ).rejects.toThrow();
    }
  });

  it('enforces ledger immutability and a one-way capability-grant lifecycle', async () => {
    const subjectId = `platform-subject-${randomUUID()}`;
    const actorId = `platform-actor-${randomUUID()}`;
    await admin.user.createMany({
      data: [
        {
          id: subjectId,
          email: `${subjectId}@test.invalid`,
          passwordHash: 'not-a-secret',
          firstName: 'Subject',
          lastName: 'Test',
        },
        {
          id: actorId,
          email: `${actorId}@test.invalid`,
          passwordHash: 'not-a-secret',
          firstName: 'Actor',
          lastName: 'Test',
        },
      ],
    });
    const grant = await admin.platformCapabilityGrant.create({
      data: {
        userId: subjectId,
        capability: 'SYSOP_USER_DIRECTORY_READ',
        grantedByUserId: actorId,
        grantReasonCode: 'TEST_REVIEW',
      },
    });

    // Expected database errors are each isolated in their own transaction.
    // PostgreSQL marks a transaction aborted after an error, so sharing a
    // transaction would not prove the positive transition that follows.
    await expect(
      admin.$transaction((tx) =>
        tx.platformCapabilityGrant.update({
          where: { id: grant.id },
          data: { createdAt: new Date() },
        })
      )
    ).rejects.toThrow();
    await expect(
      admin.$transaction((tx) =>
        tx.platformCapabilityGrant.update({
          where: { id: grant.id },
          data: { id: `${grant.id}-new` },
        })
      )
    ).rejects.toThrow();
    const revoked = await admin.$transaction((tx) =>
      tx.platformCapabilityGrant.update({
        where: { id: grant.id },
        data: {
          revokedAt: new Date(),
          revokedByUserId: actorId,
          revokeReasonCode: 'TEST_REVOKE',
        },
      })
    );
    expect(revoked.revokedAt).not.toBeNull();
    await expect(
      admin.$transaction((tx) =>
        tx.platformCapabilityGrant.update({
          where: { id: revoked.id },
          data: { revokeReasonCode: 'REWRITTEN' },
        })
      )
    ).rejects.toThrow();
    await expect(
      admin.$transaction((tx) => tx.platformCapabilityGrant.delete({ where: { id: revoked.id } }))
    ).rejects.toThrow();

    const event = await admin.platformAuditEvent.create({
      data: {
        action: 'SYSOP_CAPABILITY_GRANTED',
        requestId: `request-${randomUUID()}`,
        actorUserId: actorId,
        targetUserId: subjectId,
        changedFields: ['operator.capability'],
        reasonCode: 'TEST_REVIEW',
      },
    });
    await expect(
      admin.$transaction((tx) =>
        tx.platformAuditEvent.update({ where: { id: event.id }, data: { reasonCode: 'REWRITTEN' } })
      )
    ).rejects.toThrow();
    await expect(
      admin.$transaction((tx) => tx.platformAuditEvent.delete({ where: { id: event.id } }))
    ).rejects.toThrow();
    await expect(
      admin.$transaction((tx) => tx.$executeRawUnsafe('TRUNCATE TABLE platform_audit_events'))
    ).rejects.toThrow();
  });
});

// The global catalog uses the trusted service boundary rather than tenant RLS.
// These SQL checks intentionally run as the ordinary runtime database role.
describe('system room template catalog and immutable revision history', () => {
  it('preserves narrowly scoped runtime grants after broad-grant repair', async () => {
    const rows = await admin.$queryRawUnsafe<
      Array<{
        relname: string;
        rowsecurity: boolean;
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
        can_truncate: boolean;
      }>
    >(`
      SELECT relname, relrowsecurity AS rowsecurity,
        has_table_privilege('vaultspace_app', oid, 'SELECT') AS can_select,
        has_table_privilege('vaultspace_app', oid, 'INSERT') AS can_insert,
        has_table_privilege('vaultspace_app', oid, 'UPDATE') AS can_update,
        has_table_privilege('vaultspace_app', oid, 'DELETE') AS can_delete,
        has_table_privilege('vaultspace_app', oid, 'TRUNCATE') AS can_truncate
      FROM pg_class WHERE relnamespace = 'public'::regnamespace
        AND relname IN ('system_room_templates', 'system_room_template_revisions')
    `);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.rowsecurity).toBe(false);
      expect(row.can_select).toBe(true);
      expect(row.can_insert).toBe(true);
      expect(row.can_update).toBe(row.relname === 'system_room_templates');
      expect(row.can_delete).toBe(false);
      expect(row.can_truncate).toBe(false);
    }
  });

  it('allows catalog writes and reads independently of tenant context, with append-only audit', async () => {
    const templateId = `sys-test-${randomUUID()}`;
    const template = await runtime.systemRoomTemplate.create({
      data: {
        id: templateId,
        name: 'Release gate',
        description: '',
        category: 'test',
        folders: [{ name: 'Evidence', path: '/evidence' }],
      },
    });
    const updated = await runtime.systemRoomTemplate.update({
      where: { id: templateId },
      data: { enabled: false, revision: 2 },
    });
    expect(updated.enabled).toBe(false);
    for (const organizationId of ['tenant-a', 'tenant-b']) {
      const read = await runtime.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        return tx.systemRoomTemplate.findUnique({ where: { id: templateId } });
      });
      expect(read?.id).toBe(template.id);
      expect(read?.revision).toBe(2);
    }
    const audit = await runtime.systemRoomTemplateRevision.create({
      data: {
        templateId,
        revision: 2,
        actorUserId: 'test-operator',
        requestId: randomUUID(),
        snapshot: { name: updated.name, enabled: false },
      },
    });
    // Runtime privileges deny these; privileged SQL additionally proves triggers.
    for (const client of [runtime, admin]) {
      await expect(
        client.systemRoomTemplateRevision.update({
          where: { id: audit.id },
          data: { requestId: 'rewritten' },
        })
      ).rejects.toThrow();
      await expect(
        client.systemRoomTemplateRevision.delete({ where: { id: audit.id } })
      ).rejects.toThrow();
      await expect(
        client.$transaction((tx) =>
          tx.$executeRawUnsafe('TRUNCATE TABLE system_room_template_revisions')
        )
      ).rejects.toThrow();
    }
    expect(
      await runtime.systemRoomTemplateRevision.findUnique({ where: { id: audit.id } })
    ).toMatchObject({ requestId: audit.requestId });
  });

  it('rolls back catalog mutation when revision insertion fails in its transaction', async () => {
    const id = `sys-rollback-${randomUUID()}`;
    await runtime.systemRoomTemplateRevision.create({
      data: {
        templateId: id,
        revision: 1,
        snapshot: {},
        actorUserId: 'test-operator',
        requestId: randomUUID(),
      },
    });
    await expect(
      runtime.$transaction(async (tx) => {
        await tx.systemRoomTemplate.create({
          data: {
            id,
            name: 'Must roll back',
            description: '',
            category: 'test',
            folders: [],
          },
        });
        await tx.systemRoomTemplateRevision.create({
          data: {
            templateId: id,
            revision: 1,
            snapshot: {},
            actorUserId: 'test-operator',
            requestId: randomUUID(),
          },
        });
      })
    ).rejects.toThrow();
    expect(await runtime.systemRoomTemplate.findUnique({ where: { id } })).toBeNull();
  });
  it('rechecks the operator and permits only one concurrent service edit per revision', async () => {
    const operator = await admin.user.create({
      data: {
        email: `template-operator-${randomUUID()}@test.invalid`,
        passwordHash: 'not-a-login',
        firstName: 'Template',
        lastName: 'Operator',
        isActive: true,
        isPlatformOperator: true,
      },
    });
    const actor = { actorUserId: operator.id, requestId: randomUUID() };
    const input = {
      name: 'Concurrent template',
      description: '',
      category: 'test',
      folders: [{ name: 'Legal', path: '/legal' }],
    };
    const created = await systemRoomTemplateService.create(input, actor);
    const edits = await Promise.allSettled([
      systemRoomTemplateService.update(
        created.id,
        { ...input, name: 'Edit A' },
        created.revision,
        actor
      ),
      systemRoomTemplateService.update(
        created.id,
        { ...input, name: 'Edit B' },
        created.revision,
        actor
      ),
    ]);
    expect(edits.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const denied = edits.find((result) => result.status === 'rejected');
    expect(denied?.status === 'rejected' && denied.reason.status).toBe(409);
    expect(
      await runtime.systemRoomTemplateRevision.count({ where: { templateId: created.id } })
    ).toBe(2);
    await admin.user.update({ where: { id: operator.id }, data: { isPlatformOperator: false } });
    await expect(systemRoomTemplateService.create(input, actor)).rejects.toMatchObject({
      status: 403,
    });
  });
});
