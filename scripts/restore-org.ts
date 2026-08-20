/**
 * Per-Tenant Restore (Sprint 3)
 *
 *   npm run ops:restore-org -- --file <backup-dir> [--force]
 *
 * Restores ONE organization's backup (from backup-org.ts) into this system.
 * Primary use: recover a PURGED org (its ids are free).
 *
 * ⚠️ VALIDATE-BEFORE-TRUST: run a full backup→purge→restore→byte-verify round-trip
 * on a throwaway org against a live DB before trusting this. Do NOT authorize any
 * real hard-purge until that passes.
 *
 * SAFETY (per the Sprint 3 review gate — these prevent catastrophe):
 *  - NEVER a global delete. Unlike scripts/restore.ts (whole-system wipe), this is
 *    strictly org-scoped and refuses to run if the org already exists.
 *  - REFUSE-OVER-EXISTING: aborts if an org with the same id/slug/customDomain
 *    exists (a live tenant), unless --force — and --force still never touches other
 *    orgs' rows.
 *  - SHARED USER: users are CREATE-IF-ABSENT (never clobber a still-active user's
 *    password/2FA), inserted before any row that FK-references them.
 *  - FK ORDER: RESTORE_ORDER (parents first); self-referential Folder depth-sorted.
 *  - BigInt columns revived from JSON strings using the Prisma DMMF field types.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

import { Prisma } from '@prisma/client';

import { bootstrapDb } from '../src/lib/db';
import { getProviders } from '../src/providers';
import { decryptArchive } from '../src/lib/backup/archiveCrypto';
import {
  RESTORE_ORDER,
  assertRestoreOrderComplete,
} from '../src/lib/backup/tenantModelClassification';

interface Args {
  file: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  let file = '';
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') file = argv[++i] ?? '';
    else if (argv[i] === '--force') force = true;
  }
  if (!file) throw new Error('Usage: --file <backup-dir> [--force]');
  return { file, force };
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** BigInt field names per model, from the DMMF (columns Prisma types as BigInt). */
function bigIntFields(modelName: string): Set<string> {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  return new Set((model?.fields ?? []).filter((f) => f.type === 'BigInt').map((f) => f.name));
}

/** Revive a JSONL row: convert BigInt-typed fields from string back to BigInt. */
function reviveRow(row: Record<string, unknown>, bigints: Set<string>): Record<string, unknown> {
  if (bigints.size === 0) return row;
  const out = { ...row };
  for (const f of bigints) {
    if (typeof out[f] === 'string' || typeof out[f] === 'number') out[f] = BigInt(out[f] as string);
  }
  return out;
}

function readTable(dbDir: string, name: string): Record<string, unknown>[] {
  let content: string;
  try {
    content = readFileSync(join(dbDir, `${name}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Depth-order self-referential Folder rows so a parent inserts before its child. */
function depthOrderFolders(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map(rows.map((r) => [String(r['id']), r]));
  const depth = (r: Record<string, unknown>): number => {
    let d = 0;
    let cur: Record<string, unknown> | undefined = r;
    const seen = new Set<string>();
    while (cur && cur['parentId'] && !seen.has(String(cur['id']))) {
      seen.add(String(cur['id']));
      cur = byId.get(String(cur['parentId']));
      d++;
    }
    return d;
  };
  return [...rows].sort((a, b) => depth(a) - depth(b));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertRestoreOrderComplete();

  const db = bootstrapDb;
  type Delegate = { create: (a: { data: unknown }) => Promise<unknown> };

  const storage = getProviders().storage;

  // Decrypt in place, then load + verify the manifest.
  await decryptArchive(args.file);
  const manifest = JSON.parse(readFileSync(join(args.file, 'manifest.json'), 'utf8'));
  const dbDir = join(args.file, 'database');

  // Verify per-table checksums (tamper / corruption detection).
  for (const [name, meta] of Object.entries(
    manifest.tables as Record<string, { sha256: string }>
  )) {
    let content = '';
    try {
      content = readFileSync(join(dbDir, `${name}.jsonl`), 'utf8');
    } catch {
      /* empty table file may be absent */
    }
    if (sha256(content) !== meta.sha256) {
      throw new Error(`Checksum mismatch for ${name} — archive is corrupt or tampered`);
    }
  }

  const orgRow = readTable(dbDir, 'Organization')[0];
  if (!orgRow) throw new Error('Backup has no Organization row');
  const orgId = String(orgRow['id']);

  // REFUSE-OVER-EXISTING: never overwrite a live tenant. Preflight id/slug/customDomain.
  const existing = await db.organization.findFirst({
    where: {
      OR: [
        { id: orgId },
        { slug: String(orgRow['slug']) },
        ...(orgRow['customDomain'] ? [{ customDomain: String(orgRow['customDomain']) }] : []),
      ],
    },
    select: { id: true, slug: true },
  });
  if (existing && !args.force) {
    throw new Error(
      `An organization already exists that collides on id/slug/customDomain (${existing.slug}). ` +
        `Restore is for PURGED orgs. Refusing (pass --force only if you are certain; it still ` +
        `never deletes other tenants' data).`
    );
  }

  const users = readTable(dbDir, 'users_referenced');

  // ALL database inserts in ONE transaction: a partial failure rolls back cleanly
  // (no half-restored org). The org GUCs are set so RLS-enabled tables accept the
  // inserts under the tenant policies.
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${orgId}, true)`;

      // Users FIRST — create-if-absent (never clobber a shared user's live creds).
      const userBig = bigIntFields('User');
      for (const u of users) {
        const data = reviveRow(u, userBig);
        await tx.user.upsert({
          where: { id: String(data['id']) },
          create: data as never,
          update: {}, // no-op on conflict: a user may belong to other, live orgs
        });
      }

      // Organization — create-if-absent, NEVER update with stale archived data
      // (even under --force, which only bypasses the preflight refusal).
      await tx.organization.upsert({
        where: { id: orgId },
        create: reviveRow(orgRow, bigIntFields('Organization')) as never,
        update: {},
      });

      // Tenant tables in FK order, org-scoped only.
      for (const modelName of RESTORE_ORDER) {
        let rows = readTable(dbDir, modelName);
        if (rows.length === 0) continue;
        if (modelName === 'Folder') rows = depthOrderFolders(rows);
        const bigints = bigIntFields(modelName);
        const delegate = (tx as unknown as Record<string, Delegate>)[
          modelName.charAt(0).toLowerCase() + modelName.slice(1)
        ]!;
        for (const row of rows) {
          await delegate.create({ data: reviveRow(row, bigints) });
        }
      }
    },
    { timeout: 300_000 }
  );

  // Storage blobs back to their buckets/keys. Refuse to overwrite an existing
  // object (a collision would clobber another tenant's blob).
  const storageObjects = JSON.parse(
    readFileSync(join(args.file, 'storage', 'objects.json'), 'utf8')
  ) as { bucket: string; key: string; sha256: string }[];
  for (const obj of storageObjects) {
    const safeName = sha256(`${obj.bucket}/${obj.key}`) + '.blob';
    const data = readFileSync(join(args.file, 'storage', safeName));
    if (sha256(data) !== obj.sha256) {
      throw new Error(`Blob checksum mismatch: ${obj.bucket}/${obj.key}`);
    }
    let exists = false;
    try {
      await storage.get(obj.bucket, obj.key);
      exists = true;
    } catch {
      exists = false; // not found — safe to write
    }
    if (exists && !args.force) {
      throw new Error(
        `Storage key already exists (would overwrite): ${obj.bucket}/${obj.key}. ` +
          `Restore is for absent orgs.`
      );
    }
    await storage.put(obj.bucket, obj.key, data);
  }

  console.log(
    `Restored org ${orgRow['slug']}: ${Object.keys(manifest.tables).length} tables, ` +
      `${users.length} users, ${storageObjects.length} blobs.`
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
