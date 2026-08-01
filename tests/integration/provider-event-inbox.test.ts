/**
 * Real PostgreSQL contract tests for the global provider-event inbox.
 * CI runs these against a disposable database and isolated ingress role.
 */
import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { providerIngressDb } from '@/lib/db';
import { recordProviderEventConflict } from '@/lib/integrations/providerEventInbox';
import { preflightProviderEventInbox } from '@/workers/providerEventInboxPreflight';

const INGRESS_ROLE = 'vaultspace_event_ingress_test';
const INHERITED_ROLE = 'vaultspace_event_inherited_reader_test';
const TEST_DATABASE = '/vaultspace_provider_inbox_test';
const TEST_MARKER = 'vaultspace-provider-inbox-disposable-v1';
const PREDECESSOR_MIGRATION = '20260731070000_guard_password_reset_provider_final_evidence';
const TARGET_MIGRATION = '20260731080000_separate_provider_inbox_state_ownership';
const TARGET_GUARD_SOURCE_SHA256 =
  'e63693ca987c4945d08c0aefbcbe6e525b8230345b480aeaa24718af8122283e';
const TARGET_TRIGGER_DEFINITION =
  'CREATE TRIGGER provider_event_evidence_immutable BEFORE INSERT OR UPDATE ON public.provider_event_inbox FOR EACH ROW EXECUTE FUNCTION prevent_provider_event_evidence_change()';
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

function fingerprint(): string {
  return randomUUID().replaceAll('-', '').padEnd(64, '0');
}

function primaryDatabaseRule(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2010') {
    return undefined;
  }
  const message = error.meta?.['message'];
  return typeof message === 'string'
    ? message.match(/^ERROR:[ \t]*([A-Z][A-Z0-9_]*)(?:\r?\n|$)/)?.[1]
    : undefined;
}

async function expectDatabaseRule(
  operation: () => Promise<unknown>,
  expectedRule: string
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2010');
    expect((error as Prisma.PrismaClientKnownRequestError).meta?.['code']).toBe('P0001');
    expect(primaryDatabaseRule(error)).toBe(expectedRule);
    return;
  }
  throw new Error(`Expected ${expectedRule} database rejection`);
}

async function expectPermissionDenied(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2010');
    expect((error as Prisma.PrismaClientKnownRequestError).meta?.['code']).toBe('42501');
    return;
  }
  throw new Error('Expected database permission denial');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitForBackendLock(backendPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [activity] = await admin.$queryRaw<Array<{ waitEventType: string | null }>>`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${backendPid}`;
    if (activity?.waitEventType === 'Lock') {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Ingress backend ${backendPid} did not wait for the held inbox lock`);
}

function hashFile(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function targetMigrationSource(): Promise<string> {
  return readFile(
    resolve(process.cwd(), 'prisma', 'migrations', TARGET_MIGRATION, 'migration.sql'),
    'utf8'
  );
}

function sourceOutsideMigrationDo(source: string): { before: string; after: string } {
  const opening = 'DO $migration$';
  const closing = '$migration$;';
  const openingIndex = source.indexOf(opening);
  const closingIndex = source.lastIndexOf(closing);

  expect(openingIndex).toBeGreaterThanOrEqual(0);
  expect(closingIndex).toBeGreaterThan(openingIndex);

  return {
    before: source.slice(0, openingIndex),
    after: source.slice(closingIndex + closing.length),
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

const ROUTE_COMPOSITION_TOPIC =
  '/subscriptions/route-composition/resourcegroups/route-composition/providers/microsoft.communication/communicationservices/route-composition';
const ROUTE_COMPOSITION_DELIVERY_DETAIL = 'route-delivery-detail-sentinel-do-not-log';

function routeCompositionDeliveryEvent(
  eventId: string,
  options: { recipient: string; providerMessageId: string; sender: string; subject: string }
) {
  return {
    id: eventId,
    topic: ROUTE_COMPOSITION_TOPIC,
    subject: options.subject,
    eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
    dataVersion: '1.0',
    metadataVersion: '1',
    eventTime: '2026-07-31T03:00:00.000Z',
    data: {
      sender: options.sender,
      recipient: options.recipient,
      messageId: options.providerMessageId,
      status: 'Delivered',
      deliveryStatusDetails: { statusMessage: ROUTE_COMPOSITION_DELIVERY_DETAIL },
      deliveryAttemptTimeStamp: '2026-07-31T02:59:59.000Z',
    },
  };
}

function routeCompositionRequest(
  event: Record<string, unknown>,
  authorization: string
): NextRequest {
  return new NextRequest(
    'https://vaultspace.example/api/integrations/azure/event-grid/email-delivery',
    {
      method: 'POST',
      body: JSON.stringify([event]),
      headers: {
        authorization,
        'content-type': 'application/json',
        'aeg-subscription-name': 'route-composition',
        'aeg-event-type': 'Notification',
      },
    }
  );
}

function assertRouteCompositionObjectName(name: string): void {
  if (!/^zz_route_test_(?:fn|tr)_[0-9a-f]{32}$/.test(name)) {
    throw new Error('Generated route-composition test object name is invalid');
  }
}

async function assertRouteCompositionObjectsAbsent(
  triggerName: string,
  functionName: string
): Promise<void> {
  const [posture] = await admin.$queryRaw<
    Array<{ triggerExists: boolean; functionExists: boolean }>
  >`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.provider_event_inbox'::regclass
          AND tgname = ${triggerName}
          AND NOT tgisinternal
      ) AS "triggerExists",
      to_regprocedure(${`public.${functionName}()`}) IS NOT NULL AS "functionExists"`;
  expect(posture).toEqual({ triggerExists: false, functionExists: false });
}

type MigrationHistoryScenario =
  | 'valid'
  | 'invalid'
  | 'lock'
  | 'startup_gucs'
  | 'startup_timeout'
  | 'post_mutation';

type TargetMigrationInjection = 'none' | 'startup_gucs' | 'startup_timeout' | 'post_mutation';

function scenarioDatabaseName(kind: MigrationHistoryScenario): string {
  const name = `vaultspace_inbox_history_${kind}_${randomUUID().replaceAll('-', '')}`;
  if (
    !/^vaultspace_inbox_history_(valid|invalid|lock|startup_gucs|startup_timeout|post_mutation)_[0-9a-f]{32}$/.test(
      name
    )
  ) {
    throw new Error('Generated provider inbox migration-history database name is invalid');
  }
  return name;
}

function scenarioDatabaseUrl(databaseName: string): string {
  const url = new URL(process.env['DATABASE_URL_ADMIN'] ?? '');
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function databaseUrlWithStartupGucs(
  databaseUrl: string,
  statementTimeout: string,
  lockTimeout = '10s'
): string {
  const url = new URL(databaseUrl);
  if (url.searchParams.has('options')) {
    throw new Error(
      'Provider inbox migration-history URL must not already contain startup options'
    );
  }
  url.searchParams.set(
    'options',
    `-c statement_timeout=${statementTimeout} -c lock_timeout=${lockTimeout}`
  );
  return url.toString();
}

function localPrismaCli(): string {
  const cli = resolve(process.cwd(), 'node_modules/.bin/prisma');
  if (!cli.startsWith(`${process.cwd()}/`)) {
    throw new Error('Provider inbox migration-history test Prisma CLI path is invalid');
  }
  return cli;
}

function migrationDeployWrapper(): string {
  const wrapper = resolve(process.cwd(), 'scripts', 'run-prisma-migrate-deploy.mjs');
  if (!wrapper.startsWith(`${process.cwd()}/`)) {
    throw new Error('Provider inbox migration-history wrapper path is invalid');
  }
  return wrapper;
}

async function runPrismaCli(
  workspace: string,
  databaseUrl: string,
  args: string[],
  timeoutMs = 45_000,
  useMigrationDeployWrapper = false
): Promise<{ exitCode: number; output: string }> {
  if (useMigrationDeployWrapper && args.join(' ') !== 'migrate deploy') {
    throw new Error('Provider inbox migration wrapper supports only prisma migrate deploy');
  }
  const schema = join(workspace, 'prisma', 'schema.prisma');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      useMigrationDeployWrapper ? process.execPath : localPrismaCli(),
      useMigrationDeployWrapper ? [migrationDeployWrapper()] : [...args, '--schema', schema],
      {
        cwd: workspace,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: process.env['HOME'] ?? tmpdir(),
          NODE_ENV: 'test',
          ...(useMigrationDeployWrapper
            ? { MIGRATION_DATABASE_URL: databaseUrl }
            : { DATABASE_URL: databaseUrl }),
          PRISMA_HIDE_UPDATE_MESSAGE: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'] as const,
      }
    );
    let output = '';
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-16_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const killTimer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(killTimer);
      resolvePromise({
        exitCode: exitCode ?? -1,
        output: output.replaceAll(databaseUrl, '<redacted-database-secret>'),
      });
    });
  });
}

function runWrappedMigrationDeploy(
  workspace: string,
  databaseUrl: string,
  timeoutMs = 45_000
): Promise<{ exitCode: number; output: string }> {
  return runPrismaCli(workspace, databaseUrl, ['migrate', 'deploy'], timeoutMs, true);
}

async function createMigrationWorkspace(): Promise<{
  path: string;
  stageTargetMigration: (injection?: TargetMigrationInjection) => Promise<void>;
}> {
  const workspace = await mkdtemp(join(tmpdir(), 'vaultspace-provider-history-'));
  const sourcePrisma = resolve(process.cwd(), 'prisma');
  const targetPrisma = join(workspace, 'prisma');
  const targetMigrations = join(targetPrisma, 'migrations');
  await mkdir(targetPrisma, { recursive: true });
  await cp(join(sourcePrisma, 'schema.prisma'), join(targetPrisma, 'schema.prisma'));
  await cp(
    join(sourcePrisma, 'migrations', 'migration_lock.toml'),
    join(targetMigrations, 'migration_lock.toml')
  );
  for (const migrationName of (await readdir(join(sourcePrisma, 'migrations'))).sort()) {
    if (migrationName <= PREDECESSOR_MIGRATION) {
      const destination = join(targetMigrations, migrationName);
      await mkdir(destination, { recursive: true });
      await cp(
        join(sourcePrisma, 'migrations', migrationName, 'migration.sql'),
        join(destination, 'migration.sql')
      );
    }
  }
  const stageTargetMigration = async (injection: TargetMigrationInjection = 'none') => {
    const source = join(sourcePrisma, 'migrations', TARGET_MIGRATION, 'migration.sql');
    const destination = join(targetMigrations, TARGET_MIGRATION, 'migration.sql');
    const sourceBytes = await readFile(source);
    await mkdir(join(targetMigrations, TARGET_MIGRATION), { recursive: true });
    await cp(source, destination);
    expect(hashFile(await readFile(destination))).toBe(hashFile(sourceBytes));

    if (injection === 'none') {
      return;
    }

    const sourceText = sourceBytes.toString('utf8');
    const replaceOnce = (anchor: string, replacement: string) => {
      expect(sourceText.split(anchor)).toHaveLength(2);
      return sourceText.replace(anchor, replacement);
    };
    const injectedSource =
      injection === 'startup_gucs'
        ? replaceOnce(
            'BEGIN\n  -- `lock_timeout` is set before the lock request.',
            `BEGIN
  IF pg_catalog.current_setting('statement_timeout')::interval <> interval '120 seconds'
     OR pg_catalog.current_setting('lock_timeout')::interval <> interval '10 seconds' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_INBOX_TEST_STARTUP_GUCS_NOT_ACTIVE';
  END IF;

  -- \`lock_timeout\` is set before the lock request.`
          )
        : injection === 'startup_timeout'
          ? replaceOnce(
              'BEGIN\n  -- `lock_timeout` is set before the lock request.',
              `BEGIN
  IF pg_catalog.current_setting('statement_timeout')::interval <> interval '250 milliseconds'
     OR pg_catalog.current_setting('lock_timeout')::interval <> interval '10 seconds' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_INBOX_TEST_STARTUP_GUCS_NOT_ACTIVE';
  END IF;
  PERFORM pg_catalog.pg_sleep(0.5);

  -- \`lock_timeout\` is set before the lock request.`
            )
          : replaceOnce(
              '  END IF;\nEND;\n$migration$;',
              `  END IF;

  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'PROVIDER_EVENT_INBOX_TEST_POST_MUTATION_ROLLBACK';
END;
$migration$;`
            );
    await writeFile(destination, injectedSource);
    expect(hashFile(await readFile(source))).toBe(hashFile(sourceBytes));
  };
  return { path: workspace, stageTargetMigration };
}

type HistoryClient = PrismaClient;

async function assertMigrationHistoryBase(): Promise<void> {
  const [identity] = await admin.$queryRaw<
    Array<{ database: string; role: string; version: number }>
  >`
    SELECT current_database() AS database,
           current_user AS role,
           current_setting('server_version_num')::integer AS version`;
  expect(identity).toEqual({
    database: TEST_DATABASE.slice(1),
    role: 'test',
    version: expect.any(Number),
  });
  expect(identity!.version).toBeGreaterThanOrEqual(150000);
  expect(identity!.version).toBeLessThan(160000);
  const [marker] = await admin.$queryRaw<Array<{ marker: string }>>`
    SELECT marker FROM provider_inbox_test_marker WHERE marker = ${TEST_MARKER}`;
  expect(marker?.marker).toBe(TEST_MARKER);
}

async function withMigrationHistoryScenario(
  kind: MigrationHistoryScenario,
  run: (context: {
    client: HistoryClient;
    databaseUrl: string;
    workspace: string;
    stageTargetMigration: (injection?: TargetMigrationInjection) => Promise<void>;
  }) => Promise<void>
): Promise<void> {
  await assertMigrationHistoryBase();
  const databaseName = scenarioDatabaseName(kind);
  const databaseUrl = scenarioDatabaseUrl(databaseName);
  let created = false;
  let client: HistoryClient | undefined;
  let workspace: string | undefined;
  let cleanupError: unknown;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    created = true;
    const migrationWorkspace = await createMigrationWorkspace();
    workspace = migrationWorkspace.path;
    const predecessor = await runWrappedMigrationDeploy(workspace, databaseUrl);
    expect(predecessor.exitCode, predecessor.output).toBe(0);
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
    const [inbox] = await client.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 WHERE to_regclass('public.provider_event_inbox') IS NOT NULL
      ) AS exists`;
    expect(inbox?.exists, predecessor.output).toBe(true);
    await run({
      client,
      databaseUrl,
      workspace,
      stageTargetMigration: migrationWorkspace.stageTargetMigration,
    });
  } finally {
    const cleanup = await Promise.allSettled([
      client?.$disconnect(),
      workspace ? rm(workspace, { recursive: true, force: true }) : undefined,
    ]);
    const failures = cleanup.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    try {
      if (created) {
        await admin.$executeRawUnsafe(
          `DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`
        );
      }
    } catch (error) {
      cleanupError = error;
    }
    if (failures.length > 0 || cleanupError) {
      throw new AggregateError(
        [...failures.map((failure) => failure.reason), ...(cleanupError ? [cleanupError] : [])],
        `Provider inbox migration-history cleanup failed for ${kind}`
      );
    }
  }
}

async function migrationHistory(client: HistoryClient) {
  return client.$queryRaw<
    Array<{
      migrationName: string;
      finishedAt: Date | null;
      rolledBackAt: Date | null;
      logs: string | null;
    }>
  >`
    SELECT migration_name AS "migrationName", finished_at AS "finishedAt",
           rolled_back_at AS "rolledBackAt", logs
    FROM "_prisma_migrations"
    WHERE migration_name IN (${PREDECESSOR_MIGRATION}, ${TARGET_MIGRATION})
    ORDER BY started_at`;
}

async function inboxCatalogPosture(client: HistoryClient): Promise<string> {
  const [posture] = await client.$queryRaw<Array<{ posture: unknown }>>`
    SELECT jsonb_build_object(
      'tableOwner', pg_get_userbyid(relation.relowner),
      'tableAcl', COALESCE(relation.relacl::text[], ARRAY[]::text[]),
      'functionOwner', pg_get_userbyid(function.proowner),
      'functionAcl', COALESCE(function.proacl::text[], ARRAY[]::text[]),
      'functionSource', function.prosrc,
      'functionConfig', function.proconfig,
      'functionVolatile', function.provolatile,
      'functionSecurityDefiner', function.prosecdef,
      'triggerDefinition', pg_get_triggerdef(trigger.oid),
      'triggerEnabled', trigger.tgenabled,
      'triggerType', trigger.tgtype,
      'constraints', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name', constraint_row.conname,
          'definition', pg_get_constraintdef(constraint_row.oid, true)
        ) ORDER BY constraint_row.conname), '[]'::jsonb)
        FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = relation.oid AND constraint_row.contype = 'c'
      )
    ) AS posture
    FROM pg_class relation
    JOIN pg_proc function
      ON function.oid = 'public.prevent_provider_event_evidence_change()'::regprocedure
    JOIN pg_trigger trigger
      ON trigger.tgrelid = relation.oid
     AND trigger.tgname = 'provider_event_evidence_immutable'
     AND NOT trigger.tgisinternal
    WHERE relation.oid = 'public.provider_event_inbox'::regclass`;
  return JSON.stringify(posture?.posture);
}

async function seedPredecessorRows(client: HistoryClient, includeProcessing = false) {
  const [clock] = await client.$queryRaw<Array<{ observedAt: Date }>>`
    SELECT (clock_timestamp() - interval '5 minutes')::timestamp(3) AS "observedAt"`;
  const observedAt = clock!.observedAt;
  const conflictFingerprint = 'a'.repeat(64);
  const pending = receipt(fingerprint());
  const quarantined = {
    ...receipt(fingerprint()),
    providerStatus: null,
    processingStatus: 'QUARANTINED' as const,
    quarantineReasonCodes: ['PROVIDER_STATUS_MISSING'],
    lastErrorCode: 'PROVIDER_STATUS_MISSING',
  };
  const conflict = {
    ...receipt(fingerprint()),
    processingStatus: 'CONFLICT' as const,
    conflictCount: 1,
    firstConflictAt: observedAt,
    conflictingPayloadFingerprint: conflictFingerprint,
    lastConflictAt: observedAt,
    lastConflictingPayloadFingerprint: conflictFingerprint,
    lastErrorCode: 'EVENT_ID_PAYLOAD_CONFLICT',
  };
  const canonical = {
    createdAt: observedAt,
    receivedAt: observedAt,
    updatedAt: observedAt,
    nextProcessingAt: observedAt,
  };
  await client.providerEventInbox.createMany({
    data: [
      { ...pending, ...canonical },
      { ...quarantined, ...canonical },
      { ...conflict, ...canonical },
    ],
  });
  if (includeProcessing) {
    const processing = receipt(fingerprint());
    await client.providerEventInbox.create({
      data: {
        ...processing,
        ...canonical,
        processingStatus: 'PROCESSING',
        processingAttempts: 1,
        processingLeaseId: randomUUID(),
        processingLeaseExpiresAt: new Date(observedAt.getTime() + 60_000),
      },
    });
  }
  const ids = includeProcessing
    ? [pending.id, quarantined.id, conflict.id]
    : [pending.id, quarantined.id, conflict.id];
  return { ids, observedAt };
}

async function inboxRows(client: HistoryClient) {
  return client.providerEventInbox.findMany({ orderBy: { id: 'asc' } });
}

async function waitForMigrationLock(databaseName: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [waiting] = await admin.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = ${databaseName} AND wait_event_type = 'Lock'
      ) AS waiting`;
    if (waiting?.waiting) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Provider inbox migration process was not observed waiting for its lock');
}

async function assertSuccessorPosture(client: HistoryClient): Promise<void> {
  const posture = JSON.parse(await inboxCatalogPosture(client)) as {
    tableOwner: string;
    functionOwner: string;
    functionSource: string;
    functionConfig: string[];
    functionVolatile: string;
    functionSecurityDefiner: boolean;
    functionAcl: string[];
    triggerDefinition: string;
    triggerEnabled: string;
    triggerType: number;
  };
  expect(posture.tableOwner).toBe('test');
  expect(posture.functionOwner).toBe('test');
  expect(hashFile(posture.functionSource)).toBe(TARGET_GUARD_SOURCE_SHA256);
  expect(posture.functionConfig).toEqual(['search_path=pg_catalog']);
  expect(posture.functionVolatile).toBe('v');
  expect(posture.functionSecurityDefiner).toBe(false);
  expect(posture.functionAcl).toEqual(['test=X/test']);
  expect(posture.triggerDefinition).toBe(TARGET_TRIGGER_DEFINITION);
  expect(posture.triggerEnabled).toBe('O');
  expect(posture.triggerType).toBe(23);
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
    decodeURIComponent(ingressUrl.username) !== INGRESS_ROLE ||
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
    const [ingressIdentity] = await providerIngressDb.$queryRaw<
      Array<{ currentUser: string; currentDatabase: string }>
    >`
      SELECT current_user AS "currentUser", current_database() AS "currentDatabase"`;
    expect(ingressIdentity).toEqual({
      currentUser: INGRESS_ROLE,
      currentDatabase: TEST_DATABASE.slice(1),
    });
    connected = true;
  });

  afterAll(async () => {
    try {
      if (connected) {
        await admin.providerEventInbox.deleteMany({ where: { id: { startsWith: runPrefix } } });
        await admin.providerEventInbox.deleteMany({
          where: { providerMessageId: { startsWith: `${runPrefix}-route-` } },
        });
      }
    } finally {
      await Promise.allSettled([
        admin.$disconnect(),
        providerIngressDb.$disconnect(),
        secondIngress.$disconnect(),
      ]);
    }
  });

  it('passes the least-privilege and database-trigger preflight', async () => {
    await expect(preflightProviderEventInbox()).resolves.toBeUndefined();
  });

  it('maps real recognized and unknown PostgreSQL conflict failures without leaking diagnostics', async () => {
    const authenticate = vi.fn().mockResolvedValue(undefined);
    const routeConfiguration = {
      enabled: true,
      tenantId: '11111111-1111-4111-8111-111111111111',
      audience: '22222222-2222-4222-8222-222222222222',
      callerAppId: '33333333-3333-4333-8333-333333333333',
      callerObjectId: null,
      requiredRole: 'AzureEventGridSecureWebhookSubscriber',
      sources: [
        {
          subscriptionName: 'route-composition',
          topic: ROUTE_COMPOSITION_TOPIC,
        },
      ],
      activeFingerprintKeyId: 'route-composition',
      fingerprintKeys: new Map([['route-composition', Buffer.alloc(32, 13)]]),
      expectedInboxOwner: 'test',
    };

    vi.resetModules();
    vi.doMock('@/lib/integrations/acsEventGridConfig', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/integrations/acsEventGridConfig')>()),
      resolveAcsEventGridConfiguration: () => routeConfiguration,
    }));
    vi.doMock('@/lib/integrations/eventGridAuth', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/integrations/eventGridAuth')>()),
      authenticateEventGridRequest: (...args: unknown[]) => authenticate(...args),
    }));

    try {
      const routeDb = await import('@/lib/db');
      expect(routeDb.providerIngressDb).toBe(providerIngressDb);
      const { POST } = await import('@/app/api/integrations/azure/event-grid/email-delivery/route');

      for (const databaseFailure of [
        {
          name: 'recognized',
          primaryRule: 'PROVIDER_EVENT_CONFLICT_INTENT_INVALID',
          expectedErrorCode: 'EVENT_GRID_DATABASE_GUARD_REJECTED',
          expectsGuardRule: true,
        },
        {
          name: 'unknown',
          primaryRule: 'PROVIDER_EVENT_ROUTE_TEST_UNKNOWN_DATABASE_FAILURE',
          expectedErrorCode: 'EVENT_GRID_INGESTION_UNAVAILABLE',
          expectsGuardRule: false,
        },
      ] as const) {
        const suffix = randomUUID().replaceAll('-', '');
        const functionName = `zz_route_test_fn_${suffix}`;
        const triggerName = `zz_route_test_tr_${suffix}`;
        const authorization = `Bearer route-auth-${databaseFailure.name}-sentinel-do-not-log`;
        const sender = `route-sender-${databaseFailure.name}-sentinel@example.invalid`;
        const recipient = `route-recipient-${databaseFailure.name}-sentinel@example.invalid`;
        const changedRecipient = `route-conflict-${databaseFailure.name}-sentinel@example.invalid`;
        const providerMessageId = `${runPrefix}-route-message-${databaseFailure.name}-sentinel`;
        const subject = `route-subject-${databaseFailure.name}-sentinel-do-not-log`;
        const detail = `route-postgres-detail-${databaseFailure.name}-sentinel-do-not-log`;
        const eventId = `${runPrefix}-route-event-${databaseFailure.name}-${suffix}`;
        const initialEvent = routeCompositionDeliveryEvent(eventId, {
          recipient,
          providerMessageId,
          sender,
          subject,
        });
        const changedEvent = routeCompositionDeliveryEvent(eventId, {
          recipient: changedRecipient,
          providerMessageId,
          sender,
          subject,
        });
        let triggerCreated = false;
        let functionCreated = false;

        assertRouteCompositionObjectName(functionName);
        assertRouteCompositionObjectName(triggerName);
        await assertRouteCompositionObjectsAbsent(triggerName, functionName);
        try {
          const accepted = await POST(routeCompositionRequest(initialEvent, authorization));
          expect(accepted.status).toBe(200);
          expect(accepted.headers.get('cache-control')).toBe('no-store');
          await expect(accepted.json()).resolves.toEqual({
            accepted: 1,
            duplicates: 0,
            conflicts: 0,
            quarantined: 0,
          });
          expect(authenticate).toHaveBeenCalled();

          const before = await admin.providerEventInbox.findFirstOrThrow({
            where: { provider: 'acs', providerMessageId },
          });
          expect(before.processingStatus).toBe('PENDING');

          await admin.$executeRawUnsafe(`
            CREATE FUNCTION public.${quoteIdentifier(functionName)}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $route_test$
            BEGIN
              RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = '${databaseFailure.primaryRule}',
                DETAIL = '${detail}';
            END;
            $route_test$`);
          functionCreated = true;
          await admin.$executeRawUnsafe(
            `REVOKE ALL ON FUNCTION public.${quoteIdentifier(functionName)}() FROM PUBLIC`
          );
          await admin.$executeRawUnsafe(`
            CREATE TRIGGER ${quoteIdentifier(triggerName)}
            BEFORE UPDATE ON public.provider_event_inbox
            FOR EACH ROW
            EXECUTE FUNCTION public.${quoteIdentifier(functionName)}()`);
          triggerCreated = true;

          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
          try {
            const rejected = await POST(routeCompositionRequest(changedEvent, authorization));
            expect(rejected.status).toBe(503);
            expect(rejected.headers.get('cache-control')).toBe('no-store');
            const responseBody = await rejected.json();
            expect(responseBody).toEqual({ error: 'Service unavailable' });
            expect(errorSpy).toHaveBeenCalledTimes(1);

            const loggedLine = errorSpy.mock.calls[0]?.[0];
            expect(typeof loggedLine).toBe('string');
            const logged = JSON.parse(loggedLine as string) as Record<string, unknown>;
            const expectedKeys = [
              'component',
              'event',
              'outcome',
              'requestId',
              'errorCode',
              'status',
              ...(databaseFailure.expectsGuardRule ? ['databaseGuardRule'] : []),
            ].sort();
            expect(Object.keys(logged).sort()).toEqual(expectedKeys);
            expect(logged).toMatchObject({
              component: 'acs-event-grid-ingress',
              event: 'request_rejected',
              outcome: 'rejected',
              requestId: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
              ),
              errorCode: databaseFailure.expectedErrorCode,
              status: 503,
              ...(databaseFailure.expectsGuardRule
                ? { databaseGuardRule: 'PROVIDER_EVENT_CONFLICT_INTENT_INVALID' }
                : {}),
            });
            const observable = JSON.stringify({
              responseBody,
              responseHeaders: Object.fromEntries(rejected.headers),
              logged,
            });
            for (const secret of [
              authorization,
              sender,
              recipient,
              changedRecipient,
              providerMessageId,
              subject,
              detail,
              ROUTE_COMPOSITION_DELIVERY_DETAIL,
              eventId,
              before.payloadFingerprint,
              'P0001',
              ...(databaseFailure.expectsGuardRule ? [] : [databaseFailure.primaryRule]),
              functionName,
              triggerName,
            ]) {
              expect(observable).not.toContain(secret);
            }
          } finally {
            errorSpy.mockRestore();
          }

          const after = await admin.providerEventInbox.findUniqueOrThrow({
            where: { id: before.id },
          });
          expect(after).toEqual(before);
          await expect(
            admin.providerEventInbox.count({ where: { provider: 'acs', providerMessageId } })
          ).resolves.toBe(1);
        } finally {
          const cleanupErrors: unknown[] = [];
          const attemptCleanup = async (operation: () => Promise<unknown>) => {
            try {
              await operation();
            } catch (error) {
              cleanupErrors.push(error);
            }
          };
          if (triggerCreated) {
            await attemptCleanup(() =>
              admin.$executeRawUnsafe(
                `DROP TRIGGER ${quoteIdentifier(triggerName)} ON public.provider_event_inbox`
              )
            );
          }
          if (functionCreated) {
            await attemptCleanup(() =>
              admin.$executeRawUnsafe(`DROP FUNCTION public.${quoteIdentifier(functionName)}()`)
            );
          }
          await attemptCleanup(() =>
            assertRouteCompositionObjectsAbsent(triggerName, functionName)
          );
          await attemptCleanup(() =>
            admin.providerEventInbox.deleteMany({
              where: { provider: 'acs', providerMessageId },
            })
          );
          await attemptCleanup(() => assertSuccessorPosture(admin));
          if (cleanupErrors.length > 0) {
            throw new AggregateError(cleanupErrors, 'Route-composition test cleanup failed');
          }
        }
      }
    } finally {
      vi.doUnmock('@/lib/integrations/acsEventGridConfig');
      vi.doUnmock('@/lib/integrations/eventGridAuth');
      vi.resetModules();
    }
  });

  it('enforces exact ingress trigger denials without changing the receipt', async () => {
    await expectPermissionDenied(
      () => providerIngressDb.$queryRaw`SELECT public.prevent_provider_event_evidence_change()`
    );

    const data = receipt(fingerprint());
    await providerIngressDb.providerEventInbox.create({ data });
    const before = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
      where: { id: data.id },
    });
    const leaseId = randomUUID();
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          INSERT INTO "provider_event_inbox" (
            "id", "provider", "eventType", "eventIdFingerprint", "payloadFingerprint",
            "payloadFingerprintKeyId", "topicFingerprint", "providerMessageId", "providerStatus",
            "dataVersion", "metadataVersion", "eventAt", "processingStatus", "processingAttempts",
            "processingLeaseId", "processingLeaseExpiresAt"
          ) VALUES (
            ${`${runPrefix}-${randomUUID()}`}, 'acs', 'PREFLIGHT', ${fingerprint()}, ${fingerprint()},
            'integration-test', ${fingerprint()}, 'processing-denied', 'Delivered', '1.0', '1',
            clock_timestamp(), 'PROCESSING', 1, ${leaseId}, clock_timestamp() + interval '1 minute'
          )`),
      'PROVIDER_EVENT_INGRESS_INITIAL_STATE_INVALID'
    );
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          UPDATE "provider_event_inbox"
          SET "processingStatus" = 'PROCESSING', "processingAttempts" = "processingAttempts" + 1,
              "processingLeaseId" = ${leaseId},
              "processingLeaseExpiresAt" = clock_timestamp() + interval '1 minute'
          WHERE "id" = ${data.id}`),
      'PROVIDER_EVENT_CONFLICT_INTENT_INVALID'
    );
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          UPDATE "provider_event_inbox"
          SET "eventType" = 'MUTATED' WHERE "id" = ${data.id}`),
      'PROVIDER_EVENT_FIRST_SEEN_EVIDENCE_IMMUTABLE'
    );
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          UPDATE "provider_event_inbox"
          SET "processingAttempts" = "processingAttempts" + 1 WHERE "id" = ${data.id}`),
      'PROVIDER_EVENT_CONFLICT_INTENT_INVALID'
    );
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          UPDATE "provider_event_inbox"
          SET "nextProcessingAt" = "nextProcessingAt" + interval '1 minute' WHERE "id" = ${data.id}`),
      'PROVIDER_EVENT_CONFLICT_INTENT_INVALID'
    );
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          UPDATE "provider_event_inbox"
          SET "lastErrorCode" = 'INGRESS_MUTATION' WHERE "id" = ${data.id}`),
      'PROVIDER_EVENT_CONFLICT_INTENT_INVALID'
    );
    const after = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
      where: { id: data.id },
    });
    expect(after).toMatchObject({
      id: before.id,
      processingStatus: 'PENDING',
      processingAttempts: before.processingAttempts,
      nextProcessingAt: before.nextProcessingAt,
      lastErrorCode: before.lastErrorCode,
      eventType: before.eventType,
      conflictCount: 0,
    });
  });

  it('denies protected correlation tables and functions to the ingress role', async () => {
    await expectPermissionDenied(() =>
      providerIngressDb.$queryRawUnsafe(
        'SELECT 1 FROM password_reset_provider_correlations LIMIT 1'
      )
    );
    await expectPermissionDenied(() =>
      providerIngressDb.$queryRawUnsafe(
        'SELECT * FROM password_reset_provider_correlation_preflight_counts()'
      )
    );

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

    await expectPermissionDenied(() =>
      providerIngressDb.$queryRawUnsafe('SELECT 1 FROM password_reset_tokens LIMIT 1')
    );
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
    const eventIdFingerprint = fingerprint();
    const data = receipt(eventIdFingerprint);
    const firstInsertPrepared = deferred();
    const releaseFirstInsert = deferred();
    const firstInsert = providerIngressDb.$transaction(async (transaction) => {
      await transaction.providerEventInbox.create({ data });
      firstInsertPrepared.resolve();
      await releaseFirstInsert.promise;
      return 1;
    });
    await firstInsertPrepared.promise;

    const secondInsertReady = deferred();
    let secondInsertBackendPid = 0;
    const secondInsert = secondIngress.$transaction(async (transaction) => {
      const [backend] = await transaction.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid`;
      secondInsertBackendPid = backend?.pid ?? 0;
      secondInsertReady.resolve();
      return transaction.providerEventInbox.createMany({
        data: { ...data, id: `${runPrefix}-${randomUUID()}` },
        skipDuplicates: true,
      });
    });
    await secondInsertReady.promise;
    try {
      await waitForBackendLock(secondInsertBackendPid);
    } finally {
      releaseFirstInsert.resolve();
    }
    const [firstInsertCount, secondInsertResult] = await Promise.all([firstInsert, secondInsert]);
    expect(firstInsertCount).toBe(1);
    expect(secondInsertResult.count).toBe(0);

    const stored = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
      where: { provider_eventIdFingerprint: { provider: 'acs', eventIdFingerprint } },
    });
    const firstConflictLocked = deferred();
    const releaseFirstConflict = deferred();
    const firstConflict = providerIngressDb.$transaction(async (transaction) => {
      const conflictCount = await recordProviderEventConflict(
        transaction,
        stored.id,
        '4'.repeat(64)
      );
      firstConflictLocked.resolve();
      await releaseFirstConflict.promise;
      return conflictCount;
    });
    await firstConflictLocked.promise;

    const secondConflictReady = deferred();
    let secondConflictBackendPid = 0;
    const secondConflict = secondIngress.$transaction(async (transaction) => {
      const [backend] = await transaction.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid`;
      secondConflictBackendPid = backend?.pid ?? 0;
      secondConflictReady.resolve();
      return recordProviderEventConflict(transaction, stored.id, '5'.repeat(64));
    });
    await secondConflictReady.promise;
    try {
      await waitForBackendLock(secondConflictBackendPid);
    } finally {
      releaseFirstConflict.resolve();
    }
    const [firstConflictCount, secondConflictCount] = await Promise.all([
      firstConflict,
      secondConflict,
    ]);
    expect(firstConflictCount).toBe(1);
    expect(secondConflictCount).toBe(2);

    const conflicted = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(conflicted.processingStatus).toBe('CONFLICT');
    expect(conflicted.conflictCount).toBe(2);
    expect(conflicted.firstConflictAt).not.toBeNull();
    expect(conflicted.conflictingPayloadFingerprint).toBe('4'.repeat(64));
    expect(conflicted.lastConflictingPayloadFingerprint).toBe('5'.repeat(64));
  });

  it('preserves ingress evidence and projector state across every accepted conflict source state', async () => {
    const pending = receipt(fingerprint());
    const quarantined = {
      ...receipt(fingerprint()),
      providerMessageId: 'quarantine-message',
      providerStatus: null,
      processingStatus: 'QUARANTINED' as const,
      lastErrorCode: 'PROVIDER_STATUS_MISSING',
      quarantineReasonCodes: ['PROVIDER_STATUS_MISSING'],
    };
    const processing = receipt(fingerprint());
    const processed = receipt(fingerprint());
    await Promise.all([
      providerIngressDb.providerEventInbox.create({ data: pending }),
      providerIngressDb.providerEventInbox.create({ data: quarantined }),
      providerIngressDb.providerEventInbox.create({ data: processing }),
      providerIngressDb.providerEventInbox.create({ data: processed }),
    ]);
    await admin.providerEventInbox.update({
      where: { id: processing.id },
      data: {
        processingStatus: 'PROCESSING',
        processingAttempts: 3,
        processingLeaseId: randomUUID(),
        processingLeaseExpiresAt: new Date(Date.now() + 60_000),
        nextProcessingAt: new Date(Date.now() + 30_000),
      },
    });
    await admin.providerEventInbox.update({
      where: { id: processed.id },
      data: {
        processingStatus: 'PROCESSED',
        processingAttempts: 2,
        nextProcessingAt: new Date(Date.now() + 30_000),
        processedAt: new Date(),
      },
    });

    const existingConflict = receipt(fingerprint());
    await providerIngressDb.providerEventInbox.create({ data: existingConflict });
    const priorConflictAt = new Date(Date.now() + 60_000);
    await admin.providerEventInbox.update({
      where: { id: existingConflict.id },
      data: {
        processingStatus: 'CONFLICT',
        conflictCount: 1,
        firstConflictAt: priorConflictAt,
        conflictingPayloadFingerprint: '9'.repeat(64),
        lastConflictAt: priorConflictAt,
        lastConflictingPayloadFingerprint: '9'.repeat(64),
        lastErrorCode: 'EVENT_ID_PAYLOAD_CONFLICT',
        updatedAt: priorConflictAt,
      },
    });

    const sourceCases = [
      {
        data: pending,
        assertSource: (
          before: Awaited<ReturnType<typeof providerIngressDb.providerEventInbox.findUniqueOrThrow>>
        ) => {
          expect(before).toMatchObject({
            processingStatus: 'PENDING',
            conflictCount: 0,
            processingLeaseId: null,
            processingLeaseExpiresAt: null,
            processedAt: null,
          });
        },
      },
      {
        data: quarantined,
        assertSource: (
          before: Awaited<ReturnType<typeof providerIngressDb.providerEventInbox.findUniqueOrThrow>>
        ) => {
          expect(before).toMatchObject({
            processingStatus: 'QUARANTINED',
            conflictCount: 0,
            lastErrorCode: 'PROVIDER_STATUS_MISSING',
            quarantineReasonCodes: ['PROVIDER_STATUS_MISSING'],
          });
        },
      },
      {
        data: processing,
        assertSource: (
          before: Awaited<ReturnType<typeof providerIngressDb.providerEventInbox.findUniqueOrThrow>>
        ) => {
          expect(before).toMatchObject({
            processingStatus: 'PROCESSING',
            processingAttempts: 3,
            processedAt: null,
          });
          expect(before.processingLeaseId).not.toBeNull();
          expect(before.processingLeaseExpiresAt).not.toBeNull();
        },
      },
      {
        data: processed,
        assertSource: (
          before: Awaited<ReturnType<typeof providerIngressDb.providerEventInbox.findUniqueOrThrow>>
        ) => {
          expect(before).toMatchObject({
            processingStatus: 'PROCESSED',
            processingAttempts: 2,
            processingLeaseId: null,
            processingLeaseExpiresAt: null,
          });
          expect(before.processedAt).not.toBeNull();
        },
      },
      {
        data: existingConflict,
        assertSource: (
          before: Awaited<ReturnType<typeof providerIngressDb.providerEventInbox.findUniqueOrThrow>>
        ) => {
          expect(before).toMatchObject({
            processingStatus: 'CONFLICT',
            conflictCount: 1,
            conflictingPayloadFingerprint: '9'.repeat(64),
            lastConflictingPayloadFingerprint: '9'.repeat(64),
          });
          expect(before.firstConflictAt).not.toBeNull();
          expect(before.lastConflictAt).not.toBeNull();
        },
      },
    ];

    for (const { data, assertSource } of sourceCases) {
      const before = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
        where: { id: data.id },
      });
      assertSource(before);
      const observedFingerprint = fingerprint();
      const count = await recordProviderEventConflict(
        providerIngressDb,
        data.id,
        observedFingerprint
      );
      const after = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
        where: { id: data.id },
      });
      expect(count).toBe(before.conflictCount + 1);
      expect(after).toMatchObject({
        id: before.id,
        provider: before.provider,
        eventType: before.eventType,
        eventIdFingerprint: before.eventIdFingerprint,
        payloadFingerprint: before.payloadFingerprint,
        payloadFingerprintKeyId: before.payloadFingerprintKeyId,
        topicFingerprint: before.topicFingerprint,
        providerMessageId: before.providerMessageId,
        providerStatus: before.providerStatus,
        dataVersion: before.dataVersion,
        metadataVersion: before.metadataVersion,
        processingStatus: 'CONFLICT',
        conflictCount: before.conflictCount + 1,
        processingAttempts: before.processingAttempts,
        nextProcessingAt: before.nextProcessingAt,
        processedAt: before.processedAt,
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        lastErrorCode: 'EVENT_ID_PAYLOAD_CONFLICT',
        quarantineReasonCodes: before.quarantineReasonCodes,
      });
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.receivedAt).toEqual(before.receivedAt);
      expect(after.eventAt).toEqual(before.eventAt);
      expect(after.deliveryAttemptAt).toEqual(before.deliveryAttemptAt);
      expect(after.firstConflictAt).not.toBeNull();
      expect(after.lastConflictAt).not.toBeNull();
      expect(after.lastConflictAt!.getTime()).toBeGreaterThanOrEqual(
        after.firstConflictAt!.getTime()
      );
      expect(after.firstConflictAt!.getTime()).toBeGreaterThanOrEqual(before.receivedAt.getTime());
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(after.lastConflictAt!.getTime());
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
      expect(after.lastConflictingPayloadFingerprint).toBe(observedFingerprint);
      expect(after.lastConflictingPayloadFingerprint).not.toBe(before.payloadFingerprint);
      if (before.firstConflictAt) {
        expect(after.firstConflictAt).toEqual(before.firstConflictAt);
        expect(after.conflictingPayloadFingerprint).toBe(before.conflictingPayloadFingerprint);
      } else {
        expect(after.firstConflictAt).toEqual(after.lastConflictAt);
        expect(after.conflictingPayloadFingerprint).toBe(observedFingerprint);
      }
      if (before.lastConflictAt) {
        expect(after.lastConflictAt!.getTime()).toBeGreaterThanOrEqual(
          before.lastConflictAt.getTime()
        );
      }
    }
  });

  it('rejects processor-state changes, mixed conflict mutations, and terminal reversal with exact rules', async () => {
    const data = receipt(fingerprint());
    await providerIngressDb.providerEventInbox.create({ data });
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          UPDATE "provider_event_inbox"
          SET "processingStatus" = 'PROCESSED', "processedAt" = clock_timestamp()
          WHERE "id" = ${data.id}`),
      'PROVIDER_EVENT_CONFLICT_INTENT_INVALID'
    );
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          UPDATE "provider_event_inbox"
          SET "processingStatus" = 'CONFLICT',
              "conflictCount" = "conflictCount" + 1,
              "firstConflictAt" = clock_timestamp(),
              "conflictingPayloadFingerprint" = ${'8'.repeat(64)},
              "lastConflictAt" = clock_timestamp(),
              "lastConflictingPayloadFingerprint" = ${'8'.repeat(64)},
              "lastErrorCode" = 'EVENT_ID_PAYLOAD_CONFLICT',
              "processingAttempts" = "processingAttempts" + 1
          WHERE "id" = ${data.id}`),
      'PROVIDER_EVENT_CONFLICT_INTENT_INVALID'
    );
    await recordProviderEventConflict(providerIngressDb, data.id, '7'.repeat(64));
    await expectDatabaseRule(
      () =>
        providerIngressDb.$executeRaw(Prisma.sql`
          UPDATE "provider_event_inbox"
          SET "processingStatus" = 'PENDING',
              "conflictCount" = 0,
              "firstConflictAt" = NULL,
              "conflictingPayloadFingerprint" = NULL,
              "lastConflictAt" = NULL,
              "lastConflictingPayloadFingerprint" = NULL
          WHERE "id" = ${data.id}`),
      'PROVIDER_EVENT_CONFLICT_TERMINAL'
    );
    const after = await providerIngressDb.providerEventInbox.findUniqueOrThrow({
      where: { id: data.id },
    });
    expect(after).toMatchObject({
      processingStatus: 'CONFLICT',
      conflictCount: 1,
      conflictingPayloadFingerprint: '7'.repeat(64),
      lastConflictingPayloadFingerprint: '7'.repeat(64),
    });
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
    const [helperUserSelect] = await admin.$queryRaw<Array<{ granted: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_class relation
        CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
        JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE relation.oid = 'public.users'::regclass
          AND grantee.rolname = ${INHERITED_ROLE}
          AND acl.privilege_type = 'SELECT'
      ) AS granted`;
    try {
      await admin.$executeRawUnsafe(`GRANT SELECT ON TABLE users TO ${INHERITED_ROLE};`);
      await admin.$executeRawUnsafe(`GRANT ${INHERITED_ROLE} TO ${INGRESS_ROLE};`);
      await expect(preflightProviderEventInbox()).rejects.toThrow(/isolated non-superuser/i);
    } finally {
      if (!inheritedRoleWasGranted) {
        await admin.$executeRawUnsafe(`REVOKE ${INHERITED_ROLE} FROM ${INGRESS_ROLE};`);
      }
      if (!helperUserSelect?.granted) {
        await admin.$executeRawUnsafe(`REVOKE SELECT ON TABLE users FROM ${INHERITED_ROLE};`);
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

  it('migrates reviewed populated predecessor inbox evidence without rewriting it', async () => {
    await withMigrationHistoryScenario('valid', async (scenario) => {
      await seedPredecessorRows(scenario.client);
      const beforeRows = JSON.stringify(await inboxRows(scenario.client));
      const beforePosture = await inboxCatalogPosture(scenario.client);
      const beforeHistory = await migrationHistory(scenario.client);
      expect(beforeHistory).toHaveLength(1);
      expect(beforeHistory[0]).toMatchObject({
        migrationName: PREDECESSOR_MIGRATION,
        finishedAt: expect.any(Date),
        rolledBackAt: null,
      });

      await scenario.stageTargetMigration();
      const result = await runWrappedMigrationDeploy(scenario.workspace, scenario.databaseUrl);
      expect(result.exitCode, result.output).toBe(0);
      expect(JSON.stringify(await inboxRows(scenario.client))).toBe(beforeRows);
      expect(await inboxCatalogPosture(scenario.client)).not.toBe(beforePosture);
      await assertSuccessorPosture(scenario.client);
      const history = await migrationHistory(scenario.client);
      expect(history).toHaveLength(2);
      expect(history[1]).toMatchObject({
        migrationName: TARGET_MIGRATION,
        finishedAt: expect.any(Date),
        rolledBackAt: null,
      });
    });
  }, 120_000);

  it('keeps the successor migration as one Prisma-visible operational statement', async () => {
    const source = await targetMigrationSource();
    const outside = sourceOutsideMigrationDo(source);
    const stripLineComments = (value: string) => value.replace(/^--.*$/gm, '').trim();

    expect(stripLineComments(outside.before)).toBe('');
    expect(outside.after.trim()).toBe('');
    expect(source.match(/DO \$migration\$/g)).toHaveLength(1);
    expect(source.match(/\$migration\$;/g)).toHaveLength(1);
    expect(source).toContain("PERFORM pg_catalog.set_config('lock_timeout', '10s', true);");
    expect(source).toContain("PERFORM pg_catalog.set_config('statement_timeout', '120s', true);");
  });

  it('proves Prisma applies the production startup GUCs before the migration DO begins', async () => {
    await withMigrationHistoryScenario('startup_gucs', async (scenario) => {
      await seedPredecessorRows(scenario.client);
      const beforeRows = JSON.stringify(await inboxRows(scenario.client));
      await scenario.stageTargetMigration('startup_gucs');
      const result = await runWrappedMigrationDeploy(scenario.workspace, scenario.databaseUrl);

      expect(result.exitCode, result.output).toBe(0);
      expect(JSON.stringify(await inboxRows(scenario.client))).toBe(beforeRows);
      await assertSuccessorPosture(scenario.client);
      const targetHistory = (await migrationHistory(scenario.client)).filter(
        (entry) => entry.migrationName === TARGET_MIGRATION
      );
      expect(targetHistory).toHaveLength(1);
      expect(targetHistory[0]).toMatchObject({
        finishedAt: expect.any(Date),
        rolledBackAt: null,
      });
    });
  }, 120_000);

  it('proves a Prisma startup statement timeout cancels the outer migration DO', async () => {
    await withMigrationHistoryScenario('startup_timeout', async (scenario) => {
      await seedPredecessorRows(scenario.client);
      const beforeRows = JSON.stringify(await inboxRows(scenario.client));
      const beforePosture = await inboxCatalogPosture(scenario.client);
      await scenario.stageTargetMigration('startup_timeout');
      const startupUrl = databaseUrlWithStartupGucs(scenario.databaseUrl, '250ms');
      const result = await runPrismaCli(scenario.workspace, startupUrl, ['migrate', 'deploy']);

      expect(result.exitCode).not.toBe(0);
      const failedTarget = (await migrationHistory(scenario.client)).filter(
        (entry) => entry.migrationName === TARGET_MIGRATION
      );
      const failureEvidence = `${result.output}\n${failedTarget[0]?.logs ?? ''}`;
      expect(failureEvidence).toMatch(/57014|statement timeout|canceling statement/i);
      expect(failureEvidence).not.toMatch(/25P02|current transaction is aborted/i);
      expect(failedTarget).toHaveLength(1);
      expect(failedTarget[0]).toMatchObject({ finishedAt: null, rolledBackAt: null });
      expect(JSON.stringify(await inboxRows(scenario.client))).toBe(beforeRows);
      expect(await inboxCatalogPosture(scenario.client)).toBe(beforePosture);
    });
  }, 120_000);

  it('rolls back all replacement work after a post-mutation migration failure', async () => {
    await withMigrationHistoryScenario('post_mutation', async (scenario) => {
      await seedPredecessorRows(scenario.client);
      const beforeRows = JSON.stringify(await inboxRows(scenario.client));
      const beforePosture = await inboxCatalogPosture(scenario.client);
      await scenario.stageTargetMigration('post_mutation');
      const result = await runWrappedMigrationDeploy(scenario.workspace, scenario.databaseUrl);

      expect(result.exitCode).not.toBe(0);
      const failedTarget = (await migrationHistory(scenario.client)).filter(
        (entry) => entry.migrationName === TARGET_MIGRATION
      );
      const failureEvidence = `${result.output}\n${failedTarget[0]?.logs ?? ''}`;
      expect(failureEvidence).toContain('PROVIDER_EVENT_INBOX_TEST_POST_MUTATION_ROLLBACK');
      expect(failureEvidence).toContain('P0001');
      expect(failureEvidence).not.toMatch(/25P02|current transaction is aborted/i);
      expect(failedTarget).toHaveLength(1);
      expect(failedTarget[0]).toMatchObject({ finishedAt: null, rolledBackAt: null });
      expect(JSON.stringify(await inboxRows(scenario.client))).toBe(beforeRows);
      expect(await inboxCatalogPosture(scenario.client)).toBe(beforePosture);

      const resolved = await runPrismaCli(scenario.workspace, scenario.databaseUrl, [
        'migrate',
        'resolve',
        '--rolled-back',
        TARGET_MIGRATION,
      ]);
      expect(resolved.exitCode, resolved.output).toBe(0);
      await scenario.stageTargetMigration();
      const retry = await runWrappedMigrationDeploy(scenario.workspace, scenario.databaseUrl);
      expect(retry.exitCode, retry.output).toBe(0);
      expect(JSON.stringify(await inboxRows(scenario.client))).toBe(beforeRows);
      await assertSuccessorPosture(scenario.client);
    });
  }, 120_000);

  it('fails closed on a processor-managed predecessor row and preserves predecessor posture', async () => {
    await withMigrationHistoryScenario('invalid', async (scenario) => {
      await seedPredecessorRows(scenario.client, true);
      const beforeRows = JSON.stringify(await inboxRows(scenario.client));
      const beforePosture = await inboxCatalogPosture(scenario.client);
      await scenario.stageTargetMigration();
      const result = await runWrappedMigrationDeploy(scenario.workspace, scenario.databaseUrl);
      expect(result.exitCode).not.toBe(0);
      const failedHistory = await migrationHistory(scenario.client);
      const failedTarget = failedHistory.filter(
        (entry) => entry.migrationName === TARGET_MIGRATION
      );
      const failureEvidence = `${result.output}\n${failedTarget[0]?.logs ?? ''}`;
      expect(failureEvidence).toContain('PROVIDER_EVENT_INBOX_PREEXISTING_STATE_INVALID');
      expect(failureEvidence).toContain('P0001');
      expect(failureEvidence).not.toMatch(/25P02|current transaction is aborted/i);
      expect(failedTarget).toHaveLength(1);
      expect(failedTarget[0]).toMatchObject({ finishedAt: null, rolledBackAt: null });
      expect(failedTarget[0]?.logs).toBeTruthy();
      expect(JSON.stringify(await inboxRows(scenario.client))).toBe(beforeRows);
      expect(await inboxCatalogPosture(scenario.client)).toBe(beforePosture);

      const resolved = await runPrismaCli(scenario.workspace, scenario.databaseUrl, [
        'migrate',
        'resolve',
        '--rolled-back',
        TARGET_MIGRATION,
      ]);
      expect(resolved.exitCode, resolved.output).toBe(0);
      const resolvedTarget = (await migrationHistory(scenario.client)).filter(
        (entry) => entry.migrationName === TARGET_MIGRATION
      );
      expect(resolvedTarget).toHaveLength(1);
      expect(resolvedTarget[0]).toMatchObject({
        finishedAt: null,
        rolledBackAt: expect.any(Date),
      });
    });
  }, 120_000);

  it('times out before an incompatible inbox lock, preserves predecessor posture, then retries', async () => {
    await withMigrationHistoryScenario('lock', async (scenario) => {
      await seedPredecessorRows(scenario.client);
      const beforeRows = JSON.stringify(await inboxRows(scenario.client));
      const beforePosture = await inboxCatalogPosture(scenario.client);
      await scenario.stageTargetMigration();
      const blocker = new PrismaClient({ datasources: { db: { url: scenario.databaseUrl } } });
      await blocker.$connect();
      let released = false;
      try {
        await blocker.$executeRawUnsafe('BEGIN');
        await blocker.$executeRawUnsafe(
          'LOCK TABLE public.provider_event_inbox IN ACCESS SHARE MODE'
        );
        const databaseName = new URL(scenario.databaseUrl).pathname.slice(1);
        const startedAt = Date.now();
        const deployment = runWrappedMigrationDeploy(scenario.workspace, scenario.databaseUrl);
        await waitForMigrationLock(databaseName);
        const result = await deployment;
        const elapsed = Date.now() - startedAt;
        expect(result.exitCode).not.toBe(0);
        expect(elapsed).toBeGreaterThanOrEqual(9_000);
        expect(elapsed).toBeLessThan(30_000);
        const failedHistory = await migrationHistory(scenario.client);
        const failedTarget = failedHistory.filter(
          (entry) => entry.migrationName === TARGET_MIGRATION
        );
        expect(`${result.output}\n${failedTarget[0]?.logs ?? ''}`).toMatch(/55P03|lock timeout/i);
        expect(failedTarget).toHaveLength(1);
        expect(failedTarget[0]).toMatchObject({ finishedAt: null, rolledBackAt: null });
        expect(JSON.stringify(await inboxRows(scenario.client))).toBe(beforeRows);
        expect(await inboxCatalogPosture(scenario.client)).toBe(beforePosture);

        await blocker.$executeRawUnsafe('ROLLBACK');
        released = true;
        const resolved = await runPrismaCli(scenario.workspace, scenario.databaseUrl, [
          'migrate',
          'resolve',
          '--rolled-back',
          TARGET_MIGRATION,
        ]);
        expect(resolved.exitCode, resolved.output).toBe(0);
        const retry = await runWrappedMigrationDeploy(scenario.workspace, scenario.databaseUrl);
        expect(retry.exitCode, retry.output).toBe(0);
        expect(JSON.stringify(await inboxRows(scenario.client))).toBe(beforeRows);
        await assertSuccessorPosture(scenario.client);
        const targetHistory = (await migrationHistory(scenario.client)).filter(
          (entry) => entry.migrationName === TARGET_MIGRATION
        );
        expect(targetHistory).toHaveLength(2);
        expect(targetHistory.some((entry) => entry.rolledBackAt instanceof Date)).toBe(true);
        expect(targetHistory.some((entry) => entry.finishedAt instanceof Date)).toBe(true);
      } finally {
        if (!released) {
          await blocker.$executeRawUnsafe('ROLLBACK').catch(() => undefined);
        }
        await blocker.$disconnect();
      }
    });
  }, 120_000);
});
