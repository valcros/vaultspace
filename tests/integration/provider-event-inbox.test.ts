/**
 * Real PostgreSQL contract tests for the global provider-event inbox.
 * CI runs these against a disposable database and isolated ingress role.
 */
import { randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { providerIngressDb } from '@/lib/db';
import { recordProviderEventConflict } from '@/lib/integrations/providerEventInbox';
import { preflightProviderEventInbox } from '@/workers/providerEventInboxPreflight';

const INGRESS_ROLE = 'vaultspace_event_ingress_test';
const INHERITED_ROLE = 'vaultspace_event_inherited_reader_test';
const TEST_DATABASE = '/vaultspace_provider_inbox_test';
const TEST_MARKER = 'vaultspace-provider-inbox-disposable-v1';
const runPrefix = `provider-inbox-${randomUUID()}`;
const testEnabled = process.env['ALLOW_PROVIDER_INBOX_TEST_DB_SETUP'] === 'true';
const dedicatedCommand = process.env['PROVIDER_INBOX_TEST_COMMAND'] === 'true';
let connected = false;

if (dedicatedCommand && !testEnabled) {
  throw new Error(
    'Set ALLOW_PROVIDER_INBOX_TEST_DB_SETUP=true only for the disposable provider inbox database'
  );
}

const admin = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL_ADMIN'] } },
});
const secondIngress = new PrismaClient({
  datasources: { db: { url: process.env['EVENT_GRID_INGRESS_DATABASE_URL'] } },
});

function receipt(eventIdFingerprint: string) {
  return {
    id: `${runPrefix}-${randomUUID()}`,
    provider: 'acs',
    eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
    eventIdFingerprint,
    payloadFingerprint: '2'.repeat(64),
    payloadFingerprintKeyId: 'integration-test',
    topicFingerprint: '3'.repeat(64),
    providerMessageId: `${runPrefix}-message`,
    providerStatus: 'Delivered',
    dataVersion: '1.0',
    metadataVersion: '1',
    eventAt: new Date(),
  };
}

function assertDisposableDatabase(): void {
  const adminUrl = new URL(process.env['DATABASE_URL_ADMIN'] ?? '');
  const ingressUrl = new URL(process.env['EVENT_GRID_INGRESS_DATABASE_URL'] ?? '');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!allowedHosts.has(adminUrl.hostname) || !allowedHosts.has(ingressUrl.hostname)) {
    throw new Error('Provider inbox integration test requires disposable local PostgreSQL');
  }
  if (
    decodeURIComponent(adminUrl.username) !== 'test' ||
    adminUrl.hostname !== ingressUrl.hostname ||
    adminUrl.pathname !== TEST_DATABASE ||
    ingressUrl.pathname !== TEST_DATABASE
  ) {
    throw new Error(`Provider inbox integration test requires ${TEST_DATABASE.slice(1)}`);
  }
  if (process.env['PROVIDER_INBOX_TEST_DATABASE_MARKER'] !== TEST_MARKER) {
    throw new Error('Provider inbox integration test marker is invalid');
  }
  if (process.env['EVENT_GRID_INBOX_EXPECTED_OWNER'] !== 'test') {
    throw new Error('Provider inbox integration test owner must be the disposable test role');
  }
}

describe.runIf(testEnabled)('provider event inbox PostgreSQL contract', () => {
  beforeAll(async () => {
    assertDisposableDatabase();
    await Promise.all([admin.$connect(), providerIngressDb.$connect(), secondIngress.$connect()]);
    const marker = await admin.$queryRaw<Array<{ marker: string }>>`
      SELECT marker FROM provider_inbox_test_marker WHERE marker = ${TEST_MARKER}`;
    if (marker[0]?.marker !== TEST_MARKER) {
      throw new Error('Disposable provider inbox database marker table is missing');
    }
    connected = true;
  });

  afterAll(async () => {
    if (!connected) {
      return;
    }
    await admin.providerEventInbox.deleteMany({ where: { id: { startsWith: runPrefix } } });
    await Promise.all([
      admin.$disconnect(),
      providerIngressDb.$disconnect(),
      secondIngress.$disconnect(),
    ]);
  });

  it('passes the least-privilege and database-trigger preflight', async () => {
    await expect(preflightProviderEventInbox()).resolves.toBeUndefined();
  });

  it('denies protected correlation tables and functions to the ingress role', async () => {
    await expect(
      providerIngressDb.$queryRawUnsafe(
        'SELECT 1 FROM password_reset_provider_correlations LIMIT 1'
      )
    ).rejects.toThrow();
    await expect(
      providerIngressDb.$queryRawUnsafe(
        'SELECT * FROM password_reset_provider_correlation_preflight_counts()'
      )
    ).rejects.toThrow();

    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION password_reset_provider_correlation_preflight_counts() TO ${INGRESS_ROLE}`
    );
    try {
      await expect(preflightProviderEventInbox()).rejects.toThrow(
        /protected correlation functions/i
      );
    } finally {
      await admin.$executeRawUnsafe(
        `REVOKE EXECUTE ON FUNCTION password_reset_provider_correlation_preflight_counts() FROM ${INGRESS_ROLE}`
      );
    }
    await expect(preflightProviderEventInbox()).resolves.toBeUndefined();
  });

  it('rejects provider-final forgery by the ingress identity after a hostile table grant', async () => {
    const existingFlowId = `${runPrefix}-final-existing-${randomUUID()}`;
    const insertedFlowId = `${runPrefix}-final-insert-${randomUUID()}`;
    const finalEvidence = {
      providerFinalStatus: 'Delivered',
      providerFinalOutcome: 'SUCCESS',
      providerFinalEventAt: new Date('2026-07-31T12:00:00.000Z'),
      providerFinalRecordedAt: new Date('2026-07-31T12:00:01.000Z'),
      providerFinalEventIdFingerprint: 'a'.repeat(64),
    } as const;

    await expect(
      providerIngressDb.$queryRawUnsafe('SELECT 1 FROM password_reset_tokens LIMIT 1')
    ).rejects.toThrow();
    await admin.passwordResetToken.create({
      data: {
        id: existingFlowId,
        userId: `${runPrefix}-final-user-${randomUUID()}`,
        token: `${runPrefix}-final-token-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await admin.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE ON TABLE password_reset_tokens TO ${INGRESS_ROLE}`
    );
    try {
      await expect(
        providerIngressDb.passwordResetToken.create({
          data: {
            id: insertedFlowId,
            userId: `${runPrefix}-final-user-${randomUUID()}`,
            token: `${runPrefix}-final-token-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60_000),
            ...finalEvidence,
          },
        })
      ).rejects.toThrow(/PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_OWNER_REQUIRED/);
      await expect(
        providerIngressDb.passwordResetToken.update({
          where: { id: existingFlowId },
          data: finalEvidence,
        })
      ).rejects.toThrow(/PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_OWNER_REQUIRED/);
    } finally {
      await admin.$executeRawUnsafe(
        `REVOKE ALL ON TABLE password_reset_tokens FROM ${INGRESS_ROLE}`
      );
      await admin.passwordResetToken.deleteMany({
        where: { id: { in: [existingFlowId, insertedFlowId] } },
      });
    }

    const [posture] = await admin.$queryRaw<Array<{ canSelect: boolean; canInsert: boolean }>>`
      SELECT
        has_table_privilege(${INGRESS_ROLE}, 'public.password_reset_tokens', 'SELECT') AS "canSelect",
        has_table_privilege(${INGRESS_ROLE}, 'public.password_reset_tokens', 'INSERT') AS "canInsert"`;
    expect(posture).toEqual({ canSelect: false, canInsert: false });
  });

  it('serializes concurrent same-ID inserts and conflict observations', async () => {
    const eventIdFingerprint = randomUUID().replaceAll('-', '').padEnd(64, '0');
    const data = receipt(eventIdFingerprint);
    const insertCounts = await Promise.all([
      providerIngressDb.providerEventInbox.createMany({ data, skipDuplicates: true }),
      secondIngress.providerEventInbox.createMany({
        data: { ...data, id: `${runPrefix}-${randomUUID()}` },
        skipDuplicates: true,
      }),
    ]);
    expect(insertCounts.reduce((total, result) => total + result.count, 0)).toBe(1);

    const stored = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
      where: { provider_eventIdFingerprint: { provider: 'acs', eventIdFingerprint } },
    });
    const conflictCounts = await Promise.all([
      recordProviderEventConflict(providerIngressDb, stored.id, '4'.repeat(64)),
      recordProviderEventConflict(secondIngress, stored.id, '5'.repeat(64)),
    ]);
    expect(conflictCounts.sort((left, right) => left - right)).toEqual([1, 2]);

    const conflicted = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(conflicted.processingStatus).toBe('CONFLICT');
    expect(conflicted.conflictCount).toBe(2);
    expect(conflicted.firstConflictAt).not.toBeNull();
    expect(conflicted.conflictingPayloadFingerprint).toMatch(/^[45]{64}$/);
    expect(conflicted.lastConflictingPayloadFingerprint).toMatch(/^[45]{64}$/);
  });

  it('rejects first-seen evidence mutation and leaving terminal conflict', async () => {
    const data = receipt('6'.repeat(64));
    await providerIngressDb.providerEventInbox.create({ data });
    await expect(
      providerIngressDb.providerEventInbox.update({
        where: { id: data.id },
        data: { eventType: 'MUTATED' },
      })
    ).rejects.toThrow();
    await recordProviderEventConflict(providerIngressDb, data.id, '7'.repeat(64));
    await expect(
      providerIngressDb.$executeRawUnsafe(`
        UPDATE provider_event_inbox
        SET "processingStatus" = 'PENDING',
            "conflictCount" = 0,
            "firstConflictAt" = NULL,
            "conflictingPayloadFingerprint" = NULL,
            "lastConflictAt" = NULL,
            "lastConflictingPayloadFingerprint" = NULL
        WHERE id = '${data.id}'
      `)
    ).rejects.toThrow();
  });

  it('detects inherited-role and PUBLIC tenant-table access', async () => {
    const membership = await admin.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_auth_members membership
        JOIN pg_roles granted ON granted.oid = membership.roleid
        JOIN pg_roles member ON member.oid = membership.member
        WHERE granted.rolname = ${INHERITED_ROLE} AND member.rolname = ${INGRESS_ROLE}
      ) AS exists`;
    const inheritedRoleWasGranted = membership[0]?.exists === true;
    await admin.$executeRawUnsafe(`GRANT SELECT ON TABLE users TO ${INHERITED_ROLE};`);
    await admin.$executeRawUnsafe(`GRANT ${INHERITED_ROLE} TO ${INGRESS_ROLE};`);
    try {
      await expect(preflightProviderEventInbox()).rejects.toThrow(/isolated non-superuser/i);
    } finally {
      if (!inheritedRoleWasGranted) {
        await admin.$executeRawUnsafe(`REVOKE ${INHERITED_ROLE} FROM ${INGRESS_ROLE};`);
      }
    }

    await admin.$executeRawUnsafe(
      `GRANT SELECT ON TABLE provider_event_inbox TO ${INHERITED_ROLE};`
    );
    try {
      await expect(preflightProviderEventInbox()).rejects.toThrow(/outside its owner/i);
    } finally {
      await admin.$executeRawUnsafe(
        `REVOKE SELECT ON TABLE provider_event_inbox FROM ${INHERITED_ROLE};`
      );
    }

    const publicGrant = await admin.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
        WHERE c.oid = 'public.users'::regclass
          AND acl.grantee = 0
          AND acl.privilege_type = 'SELECT'
      ) AS exists`;
    const publicSelectWasGranted = publicGrant[0]?.exists === true;
    await admin.$executeRawUnsafe(`GRANT SELECT ON TABLE users TO PUBLIC;`);
    try {
      await expect(preflightProviderEventInbox()).rejects.toThrow(/least-privilege/i);
    } finally {
      if (!publicSelectWasGranted) {
        await admin.$executeRawUnsafe(`REVOKE SELECT ON TABLE users FROM PUBLIC;`);
      }
    }
    await expect(preflightProviderEventInbox()).resolves.toBeUndefined();
  });

  it('rejects column grants, grant options, and an unauthorized table owner', async () => {
    await admin.$executeRawUnsafe(
      `GRANT SELECT ("providerMessageId") ON provider_event_inbox TO ${INHERITED_ROLE}`
    );
    try {
      await expect(preflightProviderEventInbox()).rejects.toThrow(/columns have privileges/i);
    } finally {
      await admin.$executeRawUnsafe(
        `REVOKE SELECT ("providerMessageId") ON provider_event_inbox FROM ${INHERITED_ROLE}`
      );
    }

    await admin.$executeRawUnsafe(`GRANT UPDATE ("firstName") ON users TO ${INGRESS_ROLE}`);
    try {
      await expect(preflightProviderEventInbox()).rejects.toThrow(/least-privilege/i);
    } finally {
      await admin.$executeRawUnsafe(`REVOKE UPDATE ("firstName") ON users FROM ${INGRESS_ROLE}`);
    }

    await admin.$executeRawUnsafe(
      `GRANT SELECT ON provider_event_inbox TO ${INGRESS_ROLE} WITH GRANT OPTION`
    );
    try {
      await expect(preflightProviderEventInbox()).rejects.toThrow(/outside its owner/i);
    } finally {
      await admin.$executeRawUnsafe(
        `REVOKE GRANT OPTION FOR SELECT ON provider_event_inbox FROM ${INGRESS_ROLE}`
      );
    }

    await admin.$executeRawUnsafe(`ALTER TABLE provider_event_inbox OWNER TO ${INHERITED_ROLE}`);
    try {
      await expect(preflightProviderEventInbox()).rejects.toThrow(
        /allowlisted migration identity/i
      );
    } finally {
      await admin.$executeRawUnsafe(`ALTER TABLE provider_event_inbox OWNER TO test`);
      await admin.$executeRawUnsafe(
        `REVOKE ALL PRIVILEGES ON provider_event_inbox FROM ${INHERITED_ROLE}`
      );
      await admin.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON provider_event_inbox TO ${INGRESS_ROLE}`
      );
    }
    await expect(preflightProviderEventInbox()).resolves.toBeUndefined();
  });
});
