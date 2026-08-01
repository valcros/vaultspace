/** Prepare a disposable local PostgreSQL database for provider inbox tests. */
import { PrismaClient } from '@prisma/client';

const INGRESS_ROLE = 'vaultspace_event_ingress_test';
const INHERITED_ROLE = 'vaultspace_event_inherited_reader_test';
const TEST_DATABASE = 'vaultspace_provider_inbox_test';
const TEST_MARKER = 'vaultspace-provider-inbox-disposable-v1';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for provider inbox test setup`);
  }
  return value;
}

function localDatabaseUrl(name: string): URL {
  const parsed = new URL(required(name));
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error(`${name} must point to disposable local PostgreSQL`);
  }
  return parsed;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  if (process.env['ALLOW_PROVIDER_INBOX_TEST_DB_SETUP'] !== 'true') {
    throw new Error('Set ALLOW_PROVIDER_INBOX_TEST_DB_SETUP=true to run this setup');
  }
  if (process.env['DEPLOYMENT_MODE'] !== 'standalone') {
    throw new Error('Provider inbox test setup requires DEPLOYMENT_MODE=standalone');
  }

  const adminUrl = localDatabaseUrl('DATABASE_URL_ADMIN');
  const ingressUrl = localDatabaseUrl('EVENT_GRID_INGRESS_DATABASE_URL');
  if (decodeURIComponent(adminUrl.username) !== 'test') {
    throw new Error('DATABASE_URL_ADMIN must authenticate as the disposable test owner');
  }
  if (decodeURIComponent(ingressUrl.username) !== INGRESS_ROLE || !ingressUrl.password) {
    throw new Error(`EVENT_GRID_INGRESS_DATABASE_URL must authenticate as ${INGRESS_ROLE}`);
  }
  const password = decodeURIComponent(ingressUrl.password);
  const databaseName = decodeURIComponent(adminUrl.pathname.slice(1));
  if (
    databaseName !== TEST_DATABASE ||
    decodeURIComponent(ingressUrl.pathname.slice(1)) !== TEST_DATABASE
  ) {
    throw new Error(`Both database URLs must target the dedicated ${TEST_DATABASE} database`);
  }
  if (process.env['PROVIDER_INBOX_TEST_DATABASE_MARKER'] !== TEST_MARKER) {
    throw new Error(
      'PROVIDER_INBOX_TEST_DATABASE_MARKER does not identify the disposable test database'
    );
  }
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await admin.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS provider_inbox_test_marker (
        marker TEXT PRIMARY KEY
      )
    `);
    await admin.$executeRawUnsafe(`
      INSERT INTO provider_inbox_test_marker (marker)
      VALUES (${sqlLiteral(TEST_MARKER)})
      ON CONFLICT (marker) DO NOTHING
    `);
    await admin.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(INGRESS_ROLE)}) THEN
          CREATE ROLE ${INGRESS_ROLE} LOGIN PASSWORD ${sqlLiteral(password)};
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(INHERITED_ROLE)}) THEN
          CREATE ROLE ${INHERITED_ROLE} NOLOGIN;
        END IF;
      END
      $$;
    `);
    await admin.$executeRawUnsafe(`
      ALTER ROLE ${INGRESS_ROLE}
        WITH LOGIN PASSWORD ${sqlLiteral(password)}
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
    `);
    await admin.$executeRawUnsafe(`REVOKE ${INHERITED_ROLE} FROM ${INGRESS_ROLE};`);
    await admin.$executeRawUnsafe(
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${INGRESS_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${INHERITED_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${INGRESS_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${INHERITED_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${INGRESS_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${INHERITED_ROLE};`
    );
    await admin.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM PUBLIC, ${INGRESS_ROLE};`);
    await admin.$executeRawUnsafe(
      `REVOKE CREATE ON DATABASE ${databaseName} FROM PUBLIC, ${INGRESS_ROLE};`
    );
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${INGRESS_ROLE};`);
    await admin.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE ON TABLE provider_event_inbox TO ${INGRESS_ROLE};`
    );
  } finally {
    await admin.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
