/**
 * RLS Audit — connects to the configured DB (via DATABASE_URL) and reports:
 *   1. Which tables have RLS enabled
 *   2. Which tables have policies attached
 *   3. Whether RLS actually enforces tenant isolation when no org context is set
 *
 * Usage:
 *   DATABASE_URL=$(az keyvault secret show --vault-name <key-vault-name> --name <db-connection-secret-name> --query value -o tsv) \
 *     npx tsx scripts/rls-audit.ts
 */
import { PrismaClient } from '@prisma/client';

const EXPECTED_RLS_TABLES = [
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
  'groups',
  'group_memberships',
  'links',
  'view_sessions',
  'events',
  'search_indexes',
  'extracted_texts',
  'watermark_configs',
  'invitations',
  'invitation_room_assignments',
];

// These tables are deliberately global and have no policy. FORCE RLS plus no
// application-role privilege is a default-deny boundary, not a missing tenant
// policy. Keep them out of EXPECTED_RLS_TABLES so the policy coverage count
// remains an honest tenant-isolation measure.
const DEFAULT_DENY_PLATFORM_TABLES = [
  'platform_sessions',
  'platform_capability_grants',
  'platform_audit_events',
];

async function main() {
  const prisma = new PrismaClient();

  const rlsStatus = await prisma.$queryRawUnsafe<
    Array<{ tablename: string; rowsecurity: boolean; forcerowsecurity: boolean }>
  >(`
    SELECT table_meta.tablename, table_meta.rowsecurity, class_meta.relforcerowsecurity AS forcerowsecurity
    FROM pg_tables table_meta
    JOIN pg_class class_meta ON class_meta.relname = table_meta.tablename
    JOIN pg_namespace namespace ON namespace.oid = class_meta.relnamespace
    WHERE table_meta.schemaname = 'public' AND namespace.nspname = 'public'
    ORDER BY table_meta.tablename;
  `);

  const policies = await prisma.$queryRawUnsafe<
    Array<{ tablename: string; policyname: string; cmd: string }>
  >(`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `);

  console.log('--- RLS STATUS ---');
  const rlsByTable = new Map(rlsStatus.map((r) => [r.tablename, r.rowsecurity]));
  for (const expected of EXPECTED_RLS_TABLES) {
    const enabled = rlsByTable.get(expected);
    if (enabled === undefined) {
      console.log(`  MISSING: ${expected} (table not found)`);
    } else {
      console.log(`  ${enabled ? 'ENABLED ' : 'DISABLED'}: ${expected}`);
    }
  }

  console.log('\n--- POLICIES ATTACHED ---');
  const policiesByTable = new Map<string, string[]>();
  for (const p of policies) {
    if (!policiesByTable.has(p.tablename)) {
      policiesByTable.set(p.tablename, []);
    }
    policiesByTable.get(p.tablename)!.push(`${p.policyname} (${p.cmd})`);
  }
  for (const expected of EXPECTED_RLS_TABLES) {
    const ps = policiesByTable.get(expected) ?? [];
    if (ps.length === 0) {
      console.log(`  NONE: ${expected}`);
    } else {
      console.log(`  ${expected}: ${ps.join(', ')}`);
    }
  }

  console.log('\n--- PLATFORM DEFAULT-DENY BOUNDARY ---');
  const platformBoundaryFailures: string[] = [];
  for (const table of DEFAULT_DENY_PLATFORM_TABLES) {
    const row = rlsStatus.find((candidate) => candidate.tablename === table);
    const policyCount = (policiesByTable.get(table) ?? []).length;
    if (!row) {
      console.log(`  MISSING: ${table}`);
      platformBoundaryFailures.push(`${table}:missing`);
    } else {
      const protectedTable = row.rowsecurity && row.forcerowsecurity && policyCount === 0;
      console.log(
        `  ${protectedTable ? 'PROTECTED' : 'INVALID  '}: ${table}` +
          ` (RLS=${row.rowsecurity}, FORCE=${row.forcerowsecurity}, policies=${policyCount})`
      );
      if (!protectedTable) {
        platformBoundaryFailures.push(`${table}:rls-force-or-policy`);
      }
    }
  }

  const [platformPrivilege] = await prisma.$queryRawUnsafe<
    Array<{
      table_privilege_remains: boolean;
      column_privilege_remains: boolean;
      sequence_privilege_remains: boolean;
      app_role_bypasses_rls: boolean;
      app_role_is_superuser: boolean;
    }>
  >(`
    WITH protected_tables(table_name) AS (
      VALUES ('platform_sessions'), ('platform_capability_grants'), ('platform_audit_events')
    )
    SELECT
      EXISTS (
        SELECT 1 FROM protected_tables
        WHERE has_table_privilege('vaultspace_app', 'public.' || quote_ident(table_name), 'SELECT')
           OR has_table_privilege('vaultspace_app', 'public.' || quote_ident(table_name), 'INSERT')
           OR has_table_privilege('vaultspace_app', 'public.' || quote_ident(table_name), 'UPDATE')
           OR has_table_privilege('vaultspace_app', 'public.' || quote_ident(table_name), 'DELETE')
           OR has_table_privilege('vaultspace_app', 'public.' || quote_ident(table_name), 'TRUNCATE')
           OR has_table_privilege('vaultspace_app', 'public.' || quote_ident(table_name), 'REFERENCES')
           OR has_table_privilege('vaultspace_app', 'public.' || quote_ident(table_name), 'TRIGGER')
      ) AS table_privilege_remains,
      EXISTS (
        SELECT 1 FROM protected_tables
        WHERE has_any_column_privilege(
          'vaultspace_app', 'public.' || quote_ident(table_name), 'SELECT,INSERT,UPDATE,REFERENCES'
        )
      ) AS column_privilege_remains,
      has_sequence_privilege('vaultspace_app', 'public.platform_audit_events_sequence_seq', 'USAGE')
        OR has_sequence_privilege('vaultspace_app', 'public.platform_audit_events_sequence_seq', 'SELECT')
        OR has_sequence_privilege('vaultspace_app', 'public.platform_audit_events_sequence_seq', 'UPDATE')
        AS sequence_privilege_remains,
      COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'vaultspace_app'), true)
        AS app_role_bypasses_rls,
      COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = 'vaultspace_app'), true)
        AS app_role_is_superuser
  `);
  console.log(
    `  runtime privilege boundary: ${
      platformPrivilege &&
      !platformPrivilege.table_privilege_remains &&
      !platformPrivilege.column_privilege_remains &&
      !platformPrivilege.sequence_privilege_remains &&
      !platformPrivilege.app_role_bypasses_rls &&
      !platformPrivilege.app_role_is_superuser
        ? 'PROTECTED'
        : 'INVALID'
    }`
  );
  if (
    !platformPrivilege ||
    platformPrivilege.table_privilege_remains ||
    platformPrivilege.column_privilege_remains ||
    platformPrivilege.sequence_privilege_remains ||
    platformPrivilege.app_role_bypasses_rls ||
    platformPrivilege.app_role_is_superuser
  ) {
    platformBoundaryFailures.push('vaultspace_app:privilege-or-role-posture');
  }

  console.log('\n--- ENFORCEMENT TEST ---');
  // Without setting app.current_org_id, the policy on rooms requires
  // organization_id = current_setting('app.current_org_id', true) which evaluates
  // to NULL on a clean session, so the predicate is false for every row.
  try {
    const noContextCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint AS count FROM rooms;'
    );
    console.log(`  rooms count without org context:        ${noContextCount[0]?.count ?? 0}`);
  } catch (err) {
    console.log(`  rooms count without org context:        ERROR (${(err as Error).message})`);
  }

  try {
    const orgs = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT id FROM organizations LIMIT 1;'
    );
    if (orgs.length === 0) {
      console.log('  no organizations available, skipping with-context check');
    } else {
      const orgId = orgs[0]!.id;
      const withContext = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_org_id = '${orgId}';`);
        const result = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          'SELECT COUNT(*)::bigint AS count FROM rooms;'
        );
        return result[0]?.count ?? BigInt(0);
      });
      console.log(`  rooms count with org context (${orgId.slice(0, 8)}...): ${withContext}`);
    }
  } catch (err) {
    console.log(`  with-context probe failed: ${(err as Error).message}`);
  }

  console.log('\n--- COVERAGE SUMMARY ---');
  let enabledCount = 0,
    policiedCount = 0;
  for (const expected of EXPECTED_RLS_TABLES) {
    if (rlsByTable.get(expected)) {
      enabledCount++;
    }
    if ((policiesByTable.get(expected) ?? []).length > 0) {
      policiedCount++;
    }
  }
  console.log(`  RLS enabled:      ${enabledCount}/${EXPECTED_RLS_TABLES.length}`);
  console.log(`  Policies attached: ${policiedCount}/${EXPECTED_RLS_TABLES.length}`);

  if (platformBoundaryFailures.length > 0) {
    throw new Error(`PLATFORM_DEFAULT_DENY_BOUNDARY_INVALID:${platformBoundaryFailures.join(',')}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
