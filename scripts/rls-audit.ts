/**
 * RLS Audit — connects to the configured DB (via DATABASE_URL) and reports:
 *   1. Which tables have RLS enabled
 *   2. Which tables have policies attached
 *   3. Whether RLS actually enforces tenant isolation when no org context is set
 *
 * Usage:
 *   DATABASE_URL=$(az keyvault secret show --vault-name kv-vaultspace-staging --name database-url --query value -o tsv) \
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
  'links',
  'view_sessions',
  'events',
  'search_indexes',
  'extracted_texts',
  'watermark_configs',
  'invitations',
];

async function main() {
  const prisma = new PrismaClient();

  const rlsStatus = await prisma.$queryRawUnsafe<
    Array<{ tablename: string; rowsecurity: boolean }>
  >(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename;
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

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
