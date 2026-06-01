#!/usr/bin/env ts-node
/**
 * Database and Storage Restore Script
 *
 * Restores database tables from JSONL and storage files from a backup directory.
 *
 * Usage:
 *   npx ts-node scripts/restore.ts <backup-dir>
 *
 * Options:
 *   --dry-run                          Show what would be restored without making changes
 *   --force                            Skip the general restore confirmation prompt
 *   --allow-destructive-reset          Permit clearing immutable audit events in a disposable DB
 *   --acknowledge-destructive-reset    Required value: DELETE_IMMUTABLE_AUDIT_EVENTS
 */

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { createInterface } from 'readline';
import { pathToFileURL } from 'url';

import { PrismaClient } from '@prisma/client';

export const DESTRUCTIVE_RESET_ACKNOWLEDGEMENT = 'DELETE_IMMUTABLE_AUDIT_EVENTS';

const restoreUsage =
  'Usage: restore.ts <backup-dir> [--dry-run] [--force] [--allow-destructive-reset] [--acknowledge-destructive-reset DELETE_IMMUTABLE_AUDIT_EVENTS]';

export class RestoreUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreUsageError';
  }
}

interface BackupManifest {
  version: string;
  timestamp: string;
  database: {
    tables: Record<string, number>;
    totalRecords: number;
  };
  storage: {
    files: number;
    totalBytes: number;
  };
}

export interface RestoreOptions {
  backupDir: string;
  dryRun: boolean;
  force: boolean;
  allowDestructiveReset: boolean;
  destructiveResetAcknowledgement?: string;
}

export type EventResetMode = 'delete-many' | 'truncate' | 'none';

export interface EventResetPlan {
  canProceed: boolean;
  mode: EventResetMode;
  message?: string;
  warnings: string[];
}

// Parse command line arguments
export function parseArgs(args = process.argv.slice(2)): RestoreOptions {
  let backupDir = '';
  let dryRun = false;
  let force = false;
  let allowDestructiveReset = false;
  let destructiveResetAcknowledgement: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--allow-destructive-reset') {
      allowDestructiveReset = true;
    } else if (arg === '--acknowledge-destructive-reset') {
      const value = args[i + 1];
      if (!value) {
        throw new RestoreUsageError(
          `--acknowledge-destructive-reset requires ${DESTRUCTIVE_RESET_ACKNOWLEDGEMENT}`
        );
      }
      destructiveResetAcknowledgement = value;
      i++;
    } else if (arg.startsWith('--acknowledge-destructive-reset=')) {
      destructiveResetAcknowledgement = arg.slice('--acknowledge-destructive-reset='.length);
    } else if (arg.startsWith('--')) {
      throw new RestoreUsageError(`Unknown option: ${arg}`);
    } else if (!backupDir && arg) {
      backupDir = arg;
    } else {
      throw new RestoreUsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (!backupDir) {
    throw new RestoreUsageError(restoreUsage);
  }

  return {
    backupDir,
    dryRun,
    force,
    allowDestructiveReset,
    ...(destructiveResetAcknowledgement !== undefined && { destructiveResetAcknowledgement }),
  };
}

export function getEventResetPlan(
  existingEventCount: number,
  options: Pick<
    RestoreOptions,
    'dryRun' | 'allowDestructiveReset' | 'destructiveResetAcknowledgement'
  >
): EventResetPlan {
  if (!Number.isInteger(existingEventCount) || existingEventCount < 0) {
    throw new Error(`Invalid existing audit event count: ${existingEventCount}`);
  }

  if (existingEventCount === 0) {
    return {
      canProceed: true,
      mode: options.dryRun ? 'none' : 'delete-many',
      warnings: [],
    };
  }

  const baseMessage = [
    `Restore target already contains ${existingEventCount} immutable audit event(s).`,
    'Audit events are append-only under SEC-013/014 and are not silently deleted by restore.',
    'Restore into an empty or explicitly disposable database by default.',
  ].join(' ');

  if (options.dryRun) {
    return {
      canProceed: true,
      mode: 'none',
      warnings: [
        `${baseMessage} A live restore without --allow-destructive-reset would stop before clearing data.`,
      ],
    };
  }

  if (!options.allowDestructiveReset) {
    return {
      canProceed: false,
      mode: 'none',
      message: `${baseMessage} Re-run only against a disposable target with --allow-destructive-reset and explicit acknowledgement if clearing those events is intended.`,
      warnings: [],
    };
  }

  if (options.destructiveResetAcknowledgement !== DESTRUCTIVE_RESET_ACKNOWLEDGEMENT) {
    return {
      canProceed: false,
      mode: 'none',
      message: [
        `${baseMessage} --allow-destructive-reset was provided, but the required acknowledgement is missing.`,
        `Add --acknowledge-destructive-reset ${DESTRUCTIVE_RESET_ACKNOWLEDGEMENT} or enter that exact phrase at the prompt.`,
      ].join(' '),
      warnings: [],
    };
  }

  return {
    canProceed: true,
    mode: 'truncate',
    warnings: [
      `${baseMessage} Explicit destructive disposable reset was acknowledged; restore will clear existing audit events with TRUNCATE without disabling or dropping the immutability trigger.`,
    ],
  };
}

// Read JSONL file and return parsed records
function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  return lines.map((line) => {
    // Parse and convert string numbers back to BigInt for file sizes
    const obj = JSON.parse(line);
    return obj as T;
  });
}

// Copy directory recursively
function copyDirRecursive(src: string, dest: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;

  if (!existsSync(src)) {
    return { files, bytes };
  }

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);

  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      const subResult = copyDirRecursive(srcPath, destPath);
      files += subResult.files;
      bytes += subResult.bytes;
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
      files++;
      bytes += stat.size;
    }
  }

  return { files, bytes };
}

// Prompt for confirmation
async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function promptForExactAcknowledgement(message: string, expected: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message}\nType ${expected} to continue: `, (answer) => {
      rl.close();
      resolve(answer === expected);
    });
  });
}

async function buildEventResetPlan(
  prisma: PrismaClient,
  options: RestoreOptions
): Promise<EventResetPlan> {
  const existingEventCount = await prisma.event.count();
  let plan = getEventResetPlan(existingEventCount, options);

  if (
    !plan.canProceed &&
    options.allowDestructiveReset &&
    !options.force &&
    options.destructiveResetAcknowledgement !== DESTRUCTIVE_RESET_ACKNOWLEDGEMENT
  ) {
    const acknowledged = await promptForExactAcknowledgement(
      'WARNING: This disposable restore path will clear existing immutable audit events.',
      DESTRUCTIVE_RESET_ACKNOWLEDGEMENT
    );

    if (acknowledged) {
      plan = getEventResetPlan(existingEventCount, {
        ...options,
        destructiveResetAcknowledgement: DESTRUCTIVE_RESET_ACKNOWLEDGEMENT,
      });
    }
  }

  return plan;
}

async function main() {
  let options: RestoreOptions;
  try {
    options = parseArgs();
  } catch (error) {
    if (error instanceof RestoreUsageError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const { backupDir, dryRun, force } = options;
  const prisma = new PrismaClient();
  const databaseDir = join(backupDir, 'database');
  const storageDir = join(backupDir, 'storage');
  const manifestPath = join(backupDir, 'manifest.json');

  // Validate backup directory
  if (!existsSync(backupDir)) {
    console.error(`Backup directory not found: ${backupDir}`);
    process.exit(1);
  }

  if (!existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  // Read manifest
  const manifest: BackupManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  console.log('Backup Information:');
  console.log(`  Version: ${manifest.version}`);
  console.log(`  Timestamp: ${manifest.timestamp}`);
  console.log(`  Database: ${manifest.database.totalRecords} records`);
  console.log(`  Storage: ${manifest.storage.files} files`);
  console.log('');

  if (dryRun) {
    console.log('[DRY RUN] No changes will be made.\n');
  }

  const eventResetPlan = await buildEventResetPlan(prisma, options);
  for (const warning of eventResetPlan.warnings) {
    console.warn(`WARNING: ${warning}`);
  }
  if (!eventResetPlan.canProceed) {
    console.error(`Restore blocked: ${eventResetPlan.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // Confirm restore
  if (!force && !dryRun) {
    const confirmed = await confirm('WARNING: This will overwrite existing data. Continue?');
    if (!confirmed) {
      console.log('Restore cancelled.');
      process.exit(0);
    }
  }

  console.log('Starting restore...\n');

  // Restore database in dependency order
  console.log('Restoring database tables...');

  if (!dryRun) {
    // Clear existing data in reverse dependency order
    console.log('  - Clearing existing data...');
    if (eventResetPlan.mode === 'truncate') {
      console.log('  - Clearing immutable audit events with explicit destructive reset...');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "events"');
    } else {
      await prisma.event.deleteMany();
    }
    await prisma.permission.deleteMany();
    await prisma.link.deleteMany();
    await prisma.groupMembership.deleteMany();
    await prisma.group.deleteMany();
    await prisma.fileBlob.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.room.deleteMany();
    await prisma.session.deleteMany();
    await prisma.userOrganization.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  }

  // Restore organizations
  const orgs = readJsonl<Record<string, unknown>>(join(databaseDir, 'organizations.jsonl'));
  if (!dryRun && orgs.length > 0) {
    await prisma.organization.createMany({ data: orgs as never[] });
  }
  console.log(`  - organizations: ${orgs.length} records`);

  // Restore users
  const users = readJsonl<Record<string, unknown>>(join(databaseDir, 'users.jsonl'));
  if (!dryRun && users.length > 0) {
    await prisma.user.createMany({ data: users as never[] });
  }
  console.log(`  - users: ${users.length} records`);

  // Restore user organizations
  const userOrgs = readJsonl<Record<string, unknown>>(
    join(databaseDir, 'user_organizations.jsonl')
  );
  if (!dryRun && userOrgs.length > 0) {
    await prisma.userOrganization.createMany({ data: userOrgs as never[] });
  }
  console.log(`  - user_organizations: ${userOrgs.length} records`);

  // Restore sessions
  const sessions = readJsonl<Record<string, unknown>>(join(databaseDir, 'sessions.jsonl'));
  if (!dryRun && sessions.length > 0) {
    await prisma.session.createMany({ data: sessions as never[] });
  }
  console.log(`  - sessions: ${sessions.length} records`);

  // Restore rooms
  const rooms = readJsonl<Record<string, unknown>>(join(databaseDir, 'rooms.jsonl'));
  if (!dryRun && rooms.length > 0) {
    await prisma.room.createMany({ data: rooms as never[] });
  }
  console.log(`  - rooms: ${rooms.length} records`);

  // Restore folders
  const folders = readJsonl<Record<string, unknown>>(join(databaseDir, 'folders.jsonl'));
  if (!dryRun && folders.length > 0) {
    await prisma.folder.createMany({ data: folders as never[] });
  }
  console.log(`  - folders: ${folders.length} records`);

  // Restore documents
  const documents = readJsonl<Record<string, unknown>>(join(databaseDir, 'documents.jsonl'));
  if (!dryRun && documents.length > 0) {
    // Convert fileSize strings back to BigInt
    const docsWithBigInt = documents.map((d) => ({
      ...d,
      fileSize: BigInt(d['fileSize'] as string | number),
    }));
    await prisma.document.createMany({ data: docsWithBigInt as never[] });
  }
  console.log(`  - documents: ${documents.length} records`);

  // Restore document versions
  const versions = readJsonl<Record<string, unknown>>(join(databaseDir, 'document_versions.jsonl'));
  if (!dryRun && versions.length > 0) {
    const versionsWithBigInt = versions.map((v) => ({
      ...v,
      fileSize: BigInt(v['fileSize'] as string | number),
    }));
    await prisma.documentVersion.createMany({ data: versionsWithBigInt as never[] });
  }
  console.log(`  - document_versions: ${versions.length} records`);

  // Restore file blobs
  const blobs = readJsonl<Record<string, unknown>>(join(databaseDir, 'file_blobs.jsonl'));
  if (!dryRun && blobs.length > 0) {
    await prisma.fileBlob.createMany({ data: blobs as never[] });
  }
  console.log(`  - file_blobs: ${blobs.length} records`);

  // Restore groups
  const groups = readJsonl<Record<string, unknown>>(join(databaseDir, 'groups.jsonl'));
  if (!dryRun && groups.length > 0) {
    await prisma.group.createMany({ data: groups as never[] });
  }
  console.log(`  - groups: ${groups.length} records`);

  // Restore group memberships
  const memberships = readJsonl<Record<string, unknown>>(
    join(databaseDir, 'group_memberships.jsonl')
  );
  if (!dryRun && memberships.length > 0) {
    await prisma.groupMembership.createMany({ data: memberships as never[] });
  }
  console.log(`  - group_memberships: ${memberships.length} records`);

  // Restore permissions
  const permissions = readJsonl<Record<string, unknown>>(join(databaseDir, 'permissions.jsonl'));
  if (!dryRun && permissions.length > 0) {
    await prisma.permission.createMany({ data: permissions as never[] });
  }
  console.log(`  - permissions: ${permissions.length} records`);

  // Restore links
  const links = readJsonl<Record<string, unknown>>(join(databaseDir, 'links.jsonl'));
  if (!dryRun && links.length > 0) {
    await prisma.link.createMany({ data: links as never[] });
  }
  console.log(`  - links: ${links.length} records`);

  // Restore events
  const events = readJsonl<Record<string, unknown>>(join(databaseDir, 'events.jsonl'));
  if (!dryRun && events.length > 0) {
    await prisma.event.createMany({ data: events as never[] });
  }
  console.log(`  - events: ${events.length} records`);

  // Restore storage files
  console.log('\nRestoring storage files...');
  const storageRoot = process.env['STORAGE_LOCAL_PATH'] ?? join(process.cwd(), 'storage');

  if (existsSync(storageDir)) {
    if (!dryRun) {
      const { files, bytes } = copyDirRecursive(storageDir, storageRoot);
      console.log(`  - ${files} files (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      // Count files for dry run
      const entries = readdirSync(storageDir);
      console.log(`  - Would restore files from ${storageDir}`);
    }
  } else {
    console.log('  - No storage files to restore');
  }

  console.log('\nRestore complete!');

  await prisma.$disconnect();
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error('Restore failed:', error);
    process.exit(1);
  });
}
