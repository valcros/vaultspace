import { randomUUID } from 'crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const admin = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'] } },
});
const runtime = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL'] } },
});

const MIGRATION = '20260731070000_guard_password_reset_provider_final_evidence';
const PREDECESSOR = '20260731060000_add_password_reset_provider_correlation_registry';
const FINAL_FIELDS = {
  providerFinalStatus: 'Delivered',
  providerFinalOutcome: 'SUCCESS',
  providerFinalEventAt: new Date('2026-07-31T12:00:00.000Z'),
  providerFinalRecordedAt: new Date('2026-07-31T12:00:01.000Z'),
  providerFinalEventIdFingerprint: 'a'.repeat(64),
} as const;

class RollbackTest extends Error {}

function databaseUrlForName(sourceUrl: string, databaseName: string): string {
  const parsed = new URL(sourceUrl);
  if (!new Set(['localhost', '127.0.0.1', '::1']).has(parsed.hostname)) {
    throw new Error('Provider-final migration tests require disposable local PostgreSQL');
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

function migrationSql(migration: string): string {
  return readFileSync(
    join(process.cwd(), 'prisma', 'migrations', migration, 'migration.sql'),
    'utf8'
  );
}

function executeSql(databaseUrl: string, sql: string): void {
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin', '--url', databaseUrl], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    input: sql,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function expectTransactionFailure(
  tx: Prisma.TransactionClient,
  savepoint: string,
  operation: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  if (!failure) {
    throw new Error(`Expected ${expectedCode}`);
  }
  expect(String(failure)).toContain(expectedCode);
  await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
}

async function withDisposableDatabases(
  databaseNames: string[],
  operation: () => Promise<void>
): Promise<void> {
  const createdDatabaseNames: string[] = [];
  let operationFailure: unknown;

  try {
    for (const databaseName of databaseNames) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
      createdDatabaseNames.push(databaseName);
    }
    await operation();
  } catch (error) {
    operationFailure = error;
  }

  const cleanupResults = await Promise.allSettled(
    createdDatabaseNames.map((databaseName) =>
      admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    )
  );
  const cleanupFailures = cleanupResults.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  );

  if (operationFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      [operationFailure, ...cleanupFailures],
      'Provider-final test operation and disposable database cleanup failed'
    );
  }
  if (operationFailure) {
    throw operationFailure;
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, 'Disposable database cleanup failed');
  }
}

async function finalEvidencePosture(client: PrismaClient | Prisma.TransactionClient) {
  const [posture] = await client.$queryRaw<
    Array<{
      protectedFunctionCount: number;
      unexpectedOverloadCount: number;
      invalidFunctionCount: number;
      unexpectedFunctionAclCount: number;
      invalidTriggerCount: number;
      invalidConstraintCount: number;
      ownerMismatchCount: number;
    }>
  >`
    WITH expected AS (
      SELECT
        'public.guard_password_reset_provider_final_evidence()'::regprocedure AS function_oid,
        'public.password_reset_tokens'::regclass AS table_oid,
        'CREATE TRIGGER password_reset_provider_final_evidence_guard BEFORE INSERT OR UPDATE OF "providerFinalStatus", "providerFinalOutcome", "providerFinalEventAt", "providerFinalRecordedAt", "providerFinalEventIdFingerprint" ON public.password_reset_tokens FOR EACH ROW EXECUTE FUNCTION guard_password_reset_provider_final_evidence()'::text AS trigger_definition
    )
    SELECT
      (
        SELECT count(*)::int
        FROM pg_proc function
        JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
        WHERE namespace.nspname = 'public'
          AND function.proname = 'guard_password_reset_provider_final_evidence'
      ) AS "protectedFunctionCount",
      (
        SELECT count(*)::int
        FROM pg_proc function
        JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
        CROSS JOIN expected
        WHERE namespace.nspname = 'public'
          AND function.proname = 'guard_password_reset_provider_final_evidence'
          AND function.oid <> expected.function_oid
      ) AS "unexpectedOverloadCount",
      (
        SELECT count(*)::int
        FROM pg_proc function
        JOIN pg_language language ON language.oid = function.prolang
        CROSS JOIN expected
        WHERE function.oid = expected.function_oid
          AND (
            function.proowner <> (SELECT relowner FROM pg_class WHERE oid = expected.table_oid)
            OR function.prosecdef
            OR function.provolatile <> 'v'
            OR function.proretset
            OR function.prorettype <> 'pg_catalog.trigger'::regtype
            OR language.lanname <> 'plpgsql'
            OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
            OR function.prosrc NOT LIKE '%PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_OWNER_REQUIRED%'
            OR function.prosrc NOT LIKE '%PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_IMMUTABLE%'
          )
      ) AS "invalidFunctionCount",
      (
        SELECT count(*)::int
        FROM pg_proc function
        CROSS JOIN LATERAL aclexplode(COALESCE(function.proacl, acldefault('f', function.proowner))) acl
        CROSS JOIN expected
        WHERE function.oid = expected.function_oid
          AND acl.grantee <> function.proowner
      ) AS "unexpectedFunctionAclCount",
      (
        SELECT count(*)::int
        FROM expected
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_trigger trigger
          WHERE trigger.tgrelid = expected.table_oid
            AND trigger.tgname = 'password_reset_provider_final_evidence_guard'
            AND trigger.tgfoid = expected.function_oid
            AND trigger.tgenabled = 'O'
            AND trigger.tgtype = 23
            AND NOT trigger.tgisinternal
            AND pg_get_triggerdef(trigger.oid) = expected.trigger_definition
        )
      ) AS "invalidTriggerCount",
      (
        SELECT count(*)::int
        FROM expected
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_constraint constraint_row
          WHERE constraint_row.conrelid = expected.table_oid
            AND constraint_row.conname = 'password_reset_provider_final_evidence_complete_check'
            AND constraint_row.contype = 'c'
            AND constraint_row.convalidated
            AND pg_get_constraintdef(constraint_row.oid) LIKE '%num_nonnulls%'
            AND pg_get_constraintdef(constraint_row.oid) LIKE '%Delivered%'
            AND pg_get_constraintdef(constraint_row.oid) LIKE '%Expanded%'
            AND pg_get_constraintdef(constraint_row.oid) LIKE '%^[0-9a-f]{64}$%'
        )
      ) AS "invalidConstraintCount",
      (
        SELECT CASE
          WHEN table_relation.relowner = function.proowner
            AND table_owner.rolname = current_user
          THEN 0 ELSE 1 END
        FROM expected
        JOIN pg_class table_relation ON table_relation.oid = expected.table_oid
        JOIN pg_roles table_owner ON table_owner.oid = table_relation.relowner
        JOIN pg_proc function ON function.oid = expected.function_oid
      )::int AS "ownerMismatchCount"`;
  if (!posture) {
    throw new Error('Provider-final evidence posture returned no result');
  }
  return posture;
}

afterAll(async () => {
  await Promise.all([admin.$disconnect(), runtime.$disconnect()]);
});

describe('password reset provider-final evidence envelope', () => {
  it('has the exact inert PostgreSQL 15 catalog posture', async () => {
    await expect(finalEvidencePosture(admin)).resolves.toEqual({
      protectedFunctionCount: 1,
      unexpectedOverloadCount: 0,
      invalidFunctionCount: 0,
      unexpectedFunctionAclCount: 0,
      invalidTriggerCount: 0,
      invalidConstraintCount: 0,
      ownerMismatchCount: 0,
    });
  });

  it('allows ordinary all-null writes but rejects runtime insert and update forgery', async () => {
    let rolledBack = false;
    try {
      await runtime.$transaction(async (tx) => {
        const flowId = `runtime-final-${randomUUID()}`;
        await tx.passwordResetToken.create({
          data: {
            id: flowId,
            userId: `runtime-user-${randomUUID()}`,
            token: `runtime-token-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        await tx.passwordResetToken.update({
          where: { id: flowId },
          data: { deliveryStatus: 'QUEUED' },
        });

        await expectTransactionFailure(
          tx,
          'runtime_final_update',
          () => tx.passwordResetToken.update({ where: { id: flowId }, data: FINAL_FIELDS }),
          'PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_OWNER_REQUIRED'
        );
        await expectTransactionFailure(
          tx,
          'runtime_final_insert',
          () =>
            tx.passwordResetToken.create({
              data: {
                id: `runtime-forged-${randomUUID()}`,
                userId: `runtime-user-${randomUUID()}`,
                token: `runtime-forged-token-${randomUUID()}`,
                expiresAt: new Date(Date.now() + 60_000),
                ...FINAL_FIELDS,
              },
            }),
          'PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_OWNER_REQUIRED'
        );
        await expectTransactionFailure(
          tx,
          'runtime_direct_trigger',
          () => tx.$queryRaw`SELECT public.guard_password_reset_provider_final_evidence()`,
          'permission denied'
        );
        throw new RollbackTest();
      });
    } catch (error) {
      if (!(error instanceof RollbackTest)) {
        throw error;
      }
      rolledBack = true;
    }
    expect(rolledBack).toBe(true);
  });

  it('allows one owner completion and makes every final field immutable', async () => {
    let rolledBack = false;
    try {
      await admin.$transaction(async (tx) => {
        const flowId = `owner-final-${randomUUID()}`;
        await tx.passwordResetToken.create({
          data: {
            id: flowId,
            userId: `owner-user-${randomUUID()}`,
            token: `owner-token-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        await tx.passwordResetToken.update({ where: { id: flowId }, data: FINAL_FIELDS });
        await expect(
          tx.passwordResetToken.findUniqueOrThrow({
            where: { id: flowId },
            select: {
              providerFinalStatus: true,
              providerFinalOutcome: true,
              providerFinalEventIdFingerprint: true,
            },
          })
        ).resolves.toEqual({
          providerFinalStatus: 'Delivered',
          providerFinalOutcome: 'SUCCESS',
          providerFinalEventIdFingerprint: 'a'.repeat(64),
        });

        await tx.passwordResetToken.update({ where: { id: flowId }, data: FINAL_FIELDS });
        await tx.passwordResetToken.update({
          where: { id: flowId },
          data: { deliveryStatus: 'CANCELLED' },
        });

        const mutations: Array<[string, Prisma.PasswordResetTokenUpdateInput]> = [
          ['owner_final_status', { providerFinalStatus: 'Failed' }],
          ['owner_final_outcome', { providerFinalOutcome: 'FAILURE' }],
          ['owner_final_event_at', { providerFinalEventAt: new Date('2026-07-31T12:00:02Z') }],
          [
            'owner_final_recorded_at',
            { providerFinalRecordedAt: new Date('2026-07-31T12:00:03Z') },
          ],
          ['owner_final_fingerprint', { providerFinalEventIdFingerprint: 'b'.repeat(64) }],
          ['owner_final_clear', { providerFinalStatus: null }],
        ];
        for (const [savepoint, data] of mutations) {
          await expectTransactionFailure(
            tx,
            savepoint,
            () => tx.passwordResetToken.update({ where: { id: flowId }, data }),
            'PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_IMMUTABLE'
          );
        }
        throw new RollbackTest();
      });
    } catch (error) {
      if (!(error instanceof RollbackTest)) {
        throw error;
      }
      rolledBack = true;
    }
    expect(rolledBack).toBe(true);
  });

  it('accepts only the reviewed status/outcome map and lowercase fingerprint shape', async () => {
    const accepted: Array<[string, 'SUCCESS' | 'FAILURE']> = [
      ['Delivered', 'SUCCESS'],
      ['Suppressed', 'FAILURE'],
      ['Bounced', 'FAILURE'],
      ['Quarantined', 'FAILURE'],
      ['FilteredSpam', 'FAILURE'],
      ['Expanded', 'FAILURE'],
      ['Failed', 'FAILURE'],
    ];
    let rolledBack = false;
    try {
      await admin.$transaction(async (tx) => {
        for (const [status, outcome] of accepted) {
          const flowId = `mapping-${status.toLowerCase()}-${randomUUID()}`;
          await tx.passwordResetToken.create({
            data: {
              id: flowId,
              userId: `mapping-user-${randomUUID()}`,
              token: `mapping-token-${randomUUID()}`,
              expiresAt: new Date(Date.now() + 60_000),
            },
          });
          await tx.passwordResetToken.update({
            where: { id: flowId },
            data: {
              ...FINAL_FIELDS,
              providerFinalStatus: status,
              providerFinalOutcome: outcome,
            },
          });
        }

        const invalid: Array<[string, Prisma.PasswordResetTokenUpdateInput]> = [
          ['mapping_delivered_failure', { ...FINAL_FIELDS, providerFinalOutcome: 'FAILURE' }],
          ['mapping_failed_success', { ...FINAL_FIELDS, providerFinalStatus: 'Failed' }],
          ['mapping_unknown_status', { ...FINAL_FIELDS, providerFinalStatus: 'Unknown' }],
          ['mapping_unknown_outcome', { ...FINAL_FIELDS, providerFinalOutcome: 'UNKNOWN' }],
          [
            'mapping_upper_fingerprint',
            { ...FINAL_FIELDS, providerFinalEventIdFingerprint: 'A'.repeat(64) },
          ],
          [
            'mapping_short_fingerprint',
            { ...FINAL_FIELDS, providerFinalEventIdFingerprint: 'a'.repeat(63) },
          ],
          [
            'mapping_nonhex_fingerprint',
            { ...FINAL_FIELDS, providerFinalEventIdFingerprint: `${'a'.repeat(63)}g` },
          ],
          ['mapping_missing_event_at', { ...FINAL_FIELDS, providerFinalEventAt: null }],
          ['mapping_missing_recorded_at', { ...FINAL_FIELDS, providerFinalRecordedAt: null }],
          ['mapping_partial', { providerFinalStatus: 'Delivered' }],
          ['mapping_four_of_five', { ...FINAL_FIELDS, providerFinalEventIdFingerprint: null }],
        ];
        for (const [savepoint, data] of invalid) {
          const flowId = `${savepoint}-${randomUUID()}`;
          await tx.passwordResetToken.create({
            data: {
              id: flowId,
              userId: `invalid-user-${randomUUID()}`,
              token: `invalid-token-${randomUUID()}`,
              expiresAt: new Date(Date.now() + 60_000),
            },
          });
          await expectTransactionFailure(
            tx,
            savepoint,
            () => tx.passwordResetToken.update({ where: { id: flowId }, data }),
            'password_reset_provider_final_evidence_complete_check'
          );
        }
        throw new RollbackTest();
      });
    } catch (error) {
      if (!(error instanceof RollbackTest)) {
        throw error;
      }
      rolledBack = true;
    }
    expect(rolledBack).toBe(true);
  });

  it('detects hostile function, trigger, and overload drift transactionally', async () => {
    let rolledBack = false;
    try {
      await admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SAVEPOINT hostile_security_definer');
        await tx.$executeRawUnsafe(
          'ALTER FUNCTION public.guard_password_reset_provider_final_evidence() SECURITY DEFINER'
        );
        expect((await finalEvidencePosture(tx)).invalidFunctionCount).toBe(1);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hostile_security_definer');

        await tx.$executeRawUnsafe('SAVEPOINT hostile_search_path');
        await tx.$executeRawUnsafe(
          'ALTER FUNCTION public.guard_password_reset_provider_final_evidence() SET search_path = public'
        );
        expect((await finalEvidencePosture(tx)).invalidFunctionCount).toBe(1);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hostile_search_path');

        await tx.$executeRawUnsafe('SAVEPOINT hostile_owner');
        await tx.$executeRawUnsafe(
          'ALTER FUNCTION public.guard_password_reset_provider_final_evidence() OWNER TO vaultspace_app'
        );
        expect((await finalEvidencePosture(tx)).ownerMismatchCount).toBe(1);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hostile_owner');

        await tx.$executeRawUnsafe('SAVEPOINT hostile_acl');
        await tx.$executeRawUnsafe(
          'GRANT EXECUTE ON FUNCTION public.guard_password_reset_provider_final_evidence() TO vaultspace_app'
        );
        expect((await finalEvidencePosture(tx)).unexpectedFunctionAclCount).toBe(1);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hostile_acl');

        await tx.$executeRawUnsafe('SAVEPOINT hostile_trigger_disabled');
        await tx.$executeRawUnsafe(
          'ALTER TABLE public.password_reset_tokens DISABLE TRIGGER password_reset_provider_final_evidence_guard'
        );
        expect((await finalEvidencePosture(tx)).invalidTriggerCount).toBe(1);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hostile_trigger_disabled');

        await tx.$executeRawUnsafe('SAVEPOINT hostile_trigger_columns');
        await tx.$executeRawUnsafe(
          'DROP TRIGGER password_reset_provider_final_evidence_guard ON public.password_reset_tokens'
        );
        await tx.$executeRawUnsafe(`
          CREATE TRIGGER password_reset_provider_final_evidence_guard
          BEFORE INSERT OR UPDATE OF "providerFinalStatus"
          ON public.password_reset_tokens
          FOR EACH ROW EXECUTE FUNCTION public.guard_password_reset_provider_final_evidence()
        `);
        expect((await finalEvidencePosture(tx)).invalidTriggerCount).toBe(1);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hostile_trigger_columns');

        await tx.$executeRawUnsafe('SAVEPOINT hostile_overload');
        await tx.$executeRawUnsafe(`
          CREATE FUNCTION public.guard_password_reset_provider_final_evidence(probe text)
          RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT probe'
        `);
        const overloadPosture = await finalEvidencePosture(tx);
        expect(overloadPosture.protectedFunctionCount).toBe(2);
        expect(overloadPosture.unexpectedOverloadCount).toBe(1);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hostile_overload');

        await tx.$executeRawUnsafe('SAVEPOINT hostile_constraint');
        await tx.$executeRawUnsafe(
          'ALTER TABLE public.password_reset_tokens DROP CONSTRAINT password_reset_provider_final_evidence_complete_check'
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE public.password_reset_tokens ADD CONSTRAINT password_reset_provider_final_evidence_complete_check CHECK (true)'
        );
        expect((await finalEvidencePosture(tx)).invalidConstraintCount).toBe(1);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT hostile_constraint');

        expect(await finalEvidencePosture(tx)).toEqual({
          protectedFunctionCount: 1,
          unexpectedOverloadCount: 0,
          invalidFunctionCount: 0,
          unexpectedFunctionAclCount: 0,
          invalidTriggerCount: 0,
          invalidConstraintCount: 0,
          ownerMismatchCount: 0,
        });
        throw new RollbackTest();
      });
    } catch (error) {
      if (!(error instanceof RollbackTest)) {
        throw error;
      }
      rolledBack = true;
    }
    expect(rolledBack).toBe(true);
  });

  it('migrates populated all-null history and rolls back on preexisting evidence', async () => {
    const adminUrl = process.env['DATABASE_URL_ADMIN'];
    if (!adminUrl) {
      throw new Error('DATABASE_URL_ADMIN is required for migration integration tests');
    }
    const successfulDatabase = `vs_final_success_${randomUUID().replaceAll('-', '')}`;
    const rollbackDatabase = `vs_final_rollback_${randomUUID().replaceAll('-', '')}`;
    const successfulUrl = databaseUrlForName(adminUrl, successfulDatabase);
    const rollbackUrl = databaseUrlForName(adminUrl, rollbackDatabase);
    const clients: PrismaClient[] = [];
    await withDisposableDatabases([successfulDatabase, rollbackDatabase], async () => {
      try {
        executeSql(successfulUrl, migrationSqlThrough(PREDECESSOR));
        executeSql(rollbackUrl, migrationSqlThrough(PREDECESSOR));
        const successfulClient = new PrismaClient({ datasources: { db: { url: successfulUrl } } });
        const rollbackClient = new PrismaClient({ datasources: { db: { url: rollbackUrl } } });
        clients.push(successfulClient, rollbackClient);
        await Promise.all(clients.map((client) => client.$connect()));

        await successfulClient.passwordResetToken.create({
          data: {
            id: `historical-null-${randomUUID()}`,
            userId: `historical-user-${randomUUID()}`,
            token: `historical-token-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        executeSql(successfulUrl, migrationSql(MIGRATION));
        expect(await successfulClient.passwordResetToken.count()).toBe(1);

        const completeFlowId = `historical-complete-${randomUUID()}`;
        const partialFlowId = `historical-partial-${randomUUID()}`;
        await rollbackClient.passwordResetToken.create({
          data: {
            id: completeFlowId,
            userId: `historical-user-${randomUUID()}`,
            token: `historical-complete-token-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60_000),
            ...FINAL_FIELDS,
          },
        });
        await rollbackClient.passwordResetToken.create({
          data: {
            id: partialFlowId,
            userId: `historical-user-${randomUUID()}`,
            token: `historical-partial-token-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60_000),
            providerFinalStatus: 'Delivered',
          },
        });
        expect(() => executeSql(rollbackUrl, migrationSql(MIGRATION))).toThrow();
        const [rollbackPosture] = await rollbackClient.$queryRaw<
          Array<{ constraintRows: number; triggerRows: number; functionName: string | null }>
        >`
        SELECT
          (
            SELECT count(*)::int FROM pg_constraint
            WHERE conrelid = 'public.password_reset_tokens'::regclass
              AND conname = 'password_reset_provider_final_evidence_complete_check'
          ) AS "constraintRows",
          (
            SELECT count(*)::int FROM pg_trigger
            WHERE tgrelid = 'public.password_reset_tokens'::regclass
              AND tgname = 'password_reset_provider_final_evidence_guard'
          ) AS "triggerRows",
          to_regprocedure('public.guard_password_reset_provider_final_evidence()')::text AS "functionName"`;
        expect(rollbackPosture).toEqual({ constraintRows: 0, triggerRows: 0, functionName: null });
        expect(
          await rollbackClient.passwordResetToken.findUniqueOrThrow({
            where: { id: completeFlowId },
            select: { providerFinalStatus: true },
          })
        ).toEqual({ providerFinalStatus: 'Delivered' });
        expect(
          await rollbackClient.passwordResetToken.findUniqueOrThrow({
            where: { id: partialFlowId },
            select: { providerFinalStatus: true, providerFinalOutcome: true },
          })
        ).toEqual({ providerFinalStatus: 'Delivered', providerFinalOutcome: null });
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    });
  }, 120_000);

  it('times out under an incompatible lock and leaves no migration residue', async () => {
    const adminUrl = process.env['DATABASE_URL_ADMIN'];
    if (!adminUrl) {
      throw new Error('DATABASE_URL_ADMIN is required for migration integration tests');
    }
    const databaseName = `vs_final_lock_${randomUUID().replaceAll('-', '')}`;
    const databaseUrl = databaseUrlForName(adminUrl, databaseName);
    const blocker = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const verifier = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await withDisposableDatabases([databaseName], async () => {
      try {
        executeSql(databaseUrl, migrationSqlThrough(PREDECESSOR));
        await Promise.all([blocker.$connect(), verifier.$connect()]);
        await blocker.$executeRawUnsafe('BEGIN');
        await blocker.$executeRawUnsafe(
          'LOCK TABLE public.password_reset_tokens IN ACCESS SHARE MODE'
        );
        const startedAt = Date.now();
        expect(() => executeSql(databaseUrl, migrationSql(MIGRATION))).toThrow();
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(9_000);
        expect(Date.now() - startedAt).toBeLessThan(30_000);
        const [posture] = await verifier.$queryRaw<
          Array<{ constraintRows: number; triggerRows: number; functionName: string | null }>
        >`
        SELECT
          (
            SELECT count(*)::int FROM pg_constraint
            WHERE conrelid = 'public.password_reset_tokens'::regclass
              AND conname = 'password_reset_provider_final_evidence_complete_check'
          ) AS "constraintRows",
          (
            SELECT count(*)::int FROM pg_trigger
            WHERE tgrelid = 'public.password_reset_tokens'::regclass
              AND tgname = 'password_reset_provider_final_evidence_guard'
          ) AS "triggerRows",
          to_regprocedure('public.guard_password_reset_provider_final_evidence()')::text AS "functionName"`;
        expect(posture).toEqual({ constraintRows: 0, triggerRows: 0, functionName: null });
        await blocker.$executeRawUnsafe('ROLLBACK');
        executeSql(databaseUrl, migrationSql(MIGRATION));
      } finally {
        await blocker.$executeRawUnsafe('ROLLBACK').catch(() => undefined);
        await Promise.allSettled([blocker.$disconnect(), verifier.$disconnect()]);
      }
    });
  }, 120_000);
});
