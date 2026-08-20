/**
 * Per-Tenant Backup (Sprint 3)
 *
 *   npm run ops:backup-org -- --org <slug|id> [--out <dir>] [--allow-active]
 *
 * Exports ONE organization's data (DB rows + referenced storage blobs) into an
 * encrypted archive, so the org can be restored after a hard-purge.
 *
 * ⚠️ VALIDATE-BEFORE-TRUST: this script CANNOT be certified without a live-DB
 * round-trip (backup → purge → restore → byte-verify a throwaway org). Do NOT
 * authorize any real hard-purge until that round-trip passes. See docs below.
 *
 * Safety properties built in (per the Sprint 3 review gate):
 *  - COMPLETENESS: the table set is derived from the schema with a fail-closed
 *    drift guard (tenantModelClassification.ts) — a new unclassified model aborts.
 *  - SCOPING: every table is read with an explicit WHERE organizationId (or parent
 *    scope), NOT trusting RLS (coverage is split); the org GUC is also set so the
 *    RLS-enforced tables are readable inside a REPEATABLE READ snapshot.
 *  - SHARED USER: referenced users are collected from every *UserId across the
 *    export and stored separately (restore create-if-absent, never clobber).
 *  - STORAGE: blobs are copied from FileBlob/PreviewAsset rows (provider get()),
 *    never a path prefix scan — guarantees DB↔storage correspondence and works on
 *    Azure/S3, not just local.
 */

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Prisma } from '@prisma/client';

import { bootstrapDb } from '../src/lib/db';
import { getProviders } from '../src/providers';
import {
  MODEL_CLASSIFICATION,
  assertClassificationComplete,
  assertRestoreOrderComplete,
  backupModelNames,
  userReferenceFields,
  bigIntFieldNames,
  stringifyBigintFields,
} from '../src/lib/backup/tenantModelClassification';
import { encryptArchiveFile } from '../src/lib/backup/archiveCrypto';

interface Args {
  org: string;
  out: string;
  allowActive: boolean;
}

function parseArgs(argv: string[]): Args {
  let org = '';
  let out = join(process.cwd(), 'backups');
  let allowActive = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--org') org = argv[++i] ?? '';
    else if (argv[i] === '--out') out = argv[++i] ?? out;
    else if (argv[i] === '--allow-active') allowActive = true;
  }
  if (!org) throw new Error('Usage: --org <slug|id> [--out <dir>] [--allow-active]');
  return { org, out, allowActive };
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Collect every referenced userId from a table's rows using the DMMF-derived
 * User-FK columns for that model (catches Event.actorId, Permission.grantedById,
 * etc. — not just *UserId).
 */
function collectUserIds(
  rows: Record<string, unknown>[],
  userFields: string[],
  into: Set<string>
): void {
  for (const row of rows) {
    for (const field of userFields) {
      const val = row[field];
      if (typeof val === 'string' && val) into.add(val);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Fail-closed completeness guards BEFORE touching data.
  assertClassificationComplete();
  assertRestoreOrderComplete();

  const db = bootstrapDb;
  type Delegate = { findMany: (a?: unknown) => Promise<Record<string, unknown>[]> };

  const storage = getProviders().storage;

  // Resolve the org (bootstrap read is unscoped/active-filtered — fine for lookup).
  const org = await db.organization.findFirst({
    where: { OR: [{ id: args.org }, { slug: args.org }] },
    select: { id: true, slug: true, name: true, isActive: true },
  });
  if (!org) throw new Error(`Organization not found: ${args.org}`);
  if (org.isActive && !args.allowActive) {
    throw new Error(
      `Refusing to back up an ACTIVE org (live-mutation risk). Disable it first, or pass ` +
        `--allow-active to override. Org: ${org.slug}`
    );
  }

  const stamp = process.env['BACKUP_STAMP'] || 'backup'; // Date.now() avoided for determinism in tests
  const backupDir = join(args.out, `org-${org.slug}-${stamp}`);
  const dbDir = join(backupDir, 'database');
  const storageDir = join(backupDir, 'storage');
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(storageDir, { recursive: true });

  const referencedUserIds = new Set<string>();
  const manifest: {
    org: typeof org;
    schemaMigration: string | null;
    tables: Record<string, { rows: number; sha256: string }>;
    storage: { objects: number; bytes: number };
    usersReferenced: number;
  } = {
    org,
    schemaMigration: process.env['BACKUP_SCHEMA_VERSION'] ?? null,
    tables: {},
    storage: { objects: 0, bytes: 0 },
    usersReferenced: 0,
  };

  // One REPEATABLE READ snapshot with the org GUCs set, so RLS-enforced tables
  // are readable AND the whole export is a single point-in-time image.
  const exported = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${org.id}, true)`;

      // Pre-fetch this org's group ids for parent-scoped GroupMembership.
      const groups = (await (tx as unknown as Record<string, Delegate>)['group']!.findMany({
        where: { organizationId: org.id },
        select: { id: true },
      })) as { id: string }[];
      const groupIds = groups.map((g) => g.id);

      const perTable: Record<string, Record<string, unknown>[]> = {};
      for (const modelName of backupModelNames()) {
        const c = MODEL_CLASSIFICATION[modelName]!;
        const delegate = (tx as unknown as Record<string, Delegate>)[
          modelName.charAt(0).toLowerCase() + modelName.slice(1)
        ]!;
        let rows: Record<string, unknown>[];
        if (c.kind === 'PARENT_SCOPED') {
          rows = groupIds.length
            ? await delegate.findMany({ where: { [c.scopeField!]: { in: groupIds } } })
            : [];
        } else {
          // EXPLICIT org filter — never trust RLS for scoping.
          rows = await delegate.findMany({ where: { organizationId: org.id } });
        }
        perTable[modelName] = rows;
        collectUserIds(rows, userReferenceFields(modelName), referencedUserIds);
      }
      // Read the Organization row itself INSIDE the snapshot (point-in-time).
      perTable['Organization'] = (await (tx as unknown as Record<string, Delegate>)[
        'organization'
      ]!.findMany({ where: { id: org.id } })) as Record<string, unknown>[];
      return perTable;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 }
  );

  // Write per-table JSONL (BigInt columns → exact strings, not lossy Number).
  const writeTable = (name: string, rows: Record<string, unknown>[]) => {
    const bigints = bigIntFieldNames(name === 'users_referenced' ? 'User' : name);
    const jsonl =
      rows.map((r) => JSON.stringify(stringifyBigintFields(r, bigints))).join('\n') +
      (rows.length ? '\n' : '');
    const file = join(dbDir, `${name}.jsonl`);
    writeFileSync(file, jsonl);
    manifest.tables[name] = { rows: rows.length, sha256: sha256(jsonl) };
  };
  for (const [name, rows] of Object.entries(exported)) writeTable(name, rows);

  // Referenced users (create-if-absent on restore; never clobber a shared user).
  const users = await db.user.findMany({ where: { id: { in: [...referencedUserIds] } } });
  writeTable('users_referenced', users);
  manifest.usersReferenced = users.length;

  // Storage: copy every blob referenced by FileBlob + PreviewAsset rows.
  const blobRefs: { bucket: string; key: string }[] = [];
  for (const r of exported['FileBlob'] ?? [])
    blobRefs.push({
      bucket: String(r['storageBucket'] ?? 'documents'),
      key: String(r['storageKey']),
    });
  for (const r of exported['PreviewAsset'] ?? [])
    if (r['storageKey'])
      blobRefs.push({
        bucket: String(r['storageBucket'] ?? 'previews'),
        key: String(r['storageKey']),
      });

  const storageManifest: { bucket: string; key: string; bytes: number; sha256: string }[] = [];
  for (const ref of blobRefs) {
    const data = await storage.get(ref.bucket, ref.key);
    const safeName = sha256(`${ref.bucket}/${ref.key}`) + '.blob';
    writeFileSync(join(storageDir, safeName), data);
    storageManifest.push({ ...ref, bytes: data.length, sha256: sha256(data) });
    manifest.storage.objects += 1;
    manifest.storage.bytes += data.length;
  }
  writeFileSync(join(storageDir, 'objects.json'), JSON.stringify(storageManifest, null, 2));

  // Manifest + encrypt-at-rest (the archive is the only encryption boundary; it
  // holds PII + password hashes + per-document keys). archiveCrypto uses an
  // authenticated envelope; the manifest is inside the authenticated boundary.
  const manifestJson = JSON.stringify(manifest, null, 2);
  writeFileSync(join(backupDir, 'manifest.json'), manifestJson);
  await encryptArchiveFile(backupDir);

  console.log(
    `Backed up org ${org.slug}: ${Object.keys(manifest.tables).length} tables, ` +
      `${manifest.usersReferenced} referenced users, ${manifest.storage.objects} blobs ` +
      `(${manifest.storage.bytes} bytes) → ${backupDir}`
  );
  console.log(
    'REMINDER: run a full backup→purge→restore→verify round-trip on a throwaway org ' +
      'against a live DB before trusting this for any real purge.'
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await bootstrapDb.$disconnect();
  });
