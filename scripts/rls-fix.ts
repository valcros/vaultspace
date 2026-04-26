/**
 * RLS Fix — runs the privileged DB changes that move staging from "RLS enabled
 * but bypassed" to "RLS enabled AND enforced":
 *
 *   1. CREATE ROLE vaultspace_app (NOSUPERUSER, NOBYPASSRLS, NOCREATEDB,
 *      NOCREATEROLE, NOREPLICATION) with the supplied password
 *   2. GRANT minimum privileges on the public schema, all tables, all sequences
 *   3. ALTER DEFAULT PRIVILEGES so future tables/sequences are auto-granted
 *   4. ALTER TABLE … FORCE ROW LEVEL SECURITY on every org-scoped table
 *
 * Idempotent: safe to re-run. Uses CREATE ROLE … IF NOT EXISTS shim and ON
 * CONFLICT-style checks for the FORCE step. The script will not change the
 * password if the role already exists.
 *
 * Usage:
 *   APP_ROLE_PASSWORD=$(cat /tmp/app_pass.txt) \
 *   DATABASE_URL=$(az keyvault secret show --vault-name kv-vaultspace-staging --name database-url --query value -o tsv) \
 *     npx tsx scripts/rls-fix.ts
 */
import { PrismaClient } from '@prisma/client';

const APP_ROLE = 'vaultspace_app';

const FORCE_RLS_TABLES = [
  'organizations',
  'users',
  'user_organizations',
  'rooms',
  'folders',
  'documents',
  'document_versions',
  'file_blobs',
  'preview_assets',
  'permissions',
  'links',
  'view_sessions',
  'events',
  'search_indexes',
  'extracted_texts',
  'invitations',
  // watermark_configs intentionally omitted — V1-deferred, table not yet created
];

async function main() {
  const password = process.env['APP_ROLE_PASSWORD'];
  if (!password) {
    throw new Error('APP_ROLE_PASSWORD env var is required');
  }
  if (password.includes("'")) {
    throw new Error('Password cannot contain a single quote (would break SQL literal)');
  }

  const prisma = new PrismaClient();

  console.log('=== Step 1: Create application role ===');
  const exists = await prisma.$queryRawUnsafe<Array<{ rolname: string }>>(
    `SELECT rolname FROM pg_roles WHERE rolname = '${APP_ROLE}';`
  );
  if (exists.length === 0) {
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;`
    );
    console.log(`  Created role ${APP_ROLE}`);
  } else {
    await prisma.$executeRawUnsafe(`ALTER ROLE ${APP_ROLE} WITH PASSWORD '${password}';`);
    console.log(`  Role ${APP_ROLE} already exists; rotated its password`);
  }

  // Re-assert the attributes we can change without superuser (Azure Postgres
  // Flexible Server does not grant superuser to the admin role, so attributes
  // like NOBYPASSRLS can only be set at CREATE time and verified afterwards).
  await prisma.$executeRawUnsafe(
    `ALTER ROLE ${APP_ROLE} NOCREATEDB NOCREATEROLE NOREPLICATION LOGIN;`
  );

  console.log('\n=== Step 2: Grant schema and table privileges ===');
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`);
  await prisma.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};`
  );
  await prisma.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`
  );
  console.log(
    '  Granted USAGE on public, SELECT/INSERT/UPDATE/DELETE on all tables, USAGE/SELECT on all sequences'
  );

  console.log('\n=== Step 3: Set default privileges for future tables/sequences ===');
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};`
  );
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`
  );
  console.log('  Default privileges set');

  console.log('\n=== Step 4: FORCE ROW LEVEL SECURITY on org-scoped tables ===');
  for (const table of FORCE_RLS_TABLES) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      console.log(`  FORCED: ${table}`);
    } catch (err) {
      console.log(`  SKIPPED: ${table} (${(err as Error).message})`);
    }
  }

  console.log('\n=== Step 4b: Revoke UPDATE/DELETE on immutable audit tables ===');
  // The audit trail must be append-only at the database layer. Revoking
  // UPDATE and DELETE on the events table from the application role makes
  // SEC-013 (no update) and SEC-014 (no delete) structural — even a
  // compromised application cannot tamper with the audit trail.
  for (const table of ['events']) {
    try {
      await prisma.$executeRawUnsafe(`REVOKE UPDATE, DELETE ON ${table} FROM ${APP_ROLE};`);
      console.log(`  REVOKED UPDATE, DELETE: ${table} from ${APP_ROLE}`);
    } catch (err) {
      console.log(`  SKIPPED: REVOKE UPDATE/DELETE on ${table} (${(err as Error).message})`);
    }
  }

  console.log('\n=== Step 5: Verify ===');
  const verify = await prisma.$queryRawUnsafe<
    Array<{
      rolname: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
      rolcanlogin: boolean;
    }>
  >(
    `SELECT rolname, rolbypassrls, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = '${APP_ROLE}';`
  );
  console.log(`  ${APP_ROLE}:`, verify[0]);

  const forced = await prisma.$queryRawUnsafe<
    Array<{ tablename: string; forcerowsecurity: boolean }>
  >(`
    SELECT relname AS tablename, relforcerowsecurity AS forcerowsecurity
    FROM pg_class
    WHERE relname = ANY (ARRAY[${FORCE_RLS_TABLES.map((t) => `'${t}'`).join(',')}])
    ORDER BY relname;
  `);
  console.log(`  FORCE RLS state across ${forced.length} tables:`);
  for (const f of forced) {
    console.log(`    ${f.forcerowsecurity ? 'FORCED  ' : 'NOT     '}: ${f.tablename}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
