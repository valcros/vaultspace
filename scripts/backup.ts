#!/usr/bin/env ts-node
/**
 * Database and Storage Backup Script
 *
 * Exports all database tables as JSONL and all storage blobs to a timestamped directory.
 *
 * Usage:
 *   npx ts-node scripts/backup.ts [--output-dir <path>]
 *
 * Output:
 *   ./backups/2026-03-14T15-30-00Z/
 *     database/
 *       organizations.jsonl
 *       users.jsonl
 *       rooms.jsonl
 *       documents.jsonl
 *       ...
 *     storage/
 *       {orgId}/
 *         documents/
 *           ...
 *     manifest.json
 */

import { createWriteStream, mkdirSync, existsSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

// Parse command line arguments
function parseArgs(): { outputDir: string } {
  const args = process.argv.slice(2);
  let outputDir = join(process.cwd(), 'backups');

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === '--output-dir' && nextArg) {
      outputDir = nextArg;
      i++;
    }
  }

  return { outputDir };
}

// Generate timestamp string for directory naming
function getTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
}

// Write records to JSONL file (one JSON object per line)
async function writeJsonl<T extends object>(filePath: string, records: T[]): Promise<number> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const stream = createWriteStream(filePath);

  for (const record of records) {
    // Convert BigInt to string for JSON serialization
    const serializable = JSON.stringify(record, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    stream.write(serializable + '\n');
  }

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(records.length));
    stream.on('error', reject);
    stream.end();
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
      copyFileSync(srcPath, destPath);
      files++;
      bytes += stat.size;
    }
  }

  return { files, bytes };
}

async function main() {
  const { outputDir } = parseArgs();
  const timestamp = getTimestamp();
  const backupDir = join(outputDir, timestamp);
  const databaseDir = join(backupDir, 'database');
  const storageDir = join(backupDir, 'storage');

  console.log(`Starting backup to: ${backupDir}`);

  // Create directories
  mkdirSync(databaseDir, { recursive: true });
  mkdirSync(storageDir, { recursive: true });

  const manifest: BackupManifest = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: {
      tables: {},
      totalRecords: 0,
    },
    storage: {
      files: 0,
      totalBytes: 0,
    },
  };

  // Export database tables
  console.log('Exporting database tables...');

  // Organizations
  const organizations = await prisma.organization.findMany();
  const orgCount = await writeJsonl(join(databaseDir, 'organizations.jsonl'), organizations);
  manifest.database.tables['organizations'] = orgCount;
  console.log(`  - organizations: ${orgCount} records`);

  // Users
  const users = await prisma.user.findMany();
  const userCount = await writeJsonl(join(databaseDir, 'users.jsonl'), users);
  manifest.database.tables['users'] = userCount;
  console.log(`  - users: ${userCount} records`);

  // UserOrganizations
  const userOrgs = await prisma.userOrganization.findMany();
  const userOrgCount = await writeJsonl(join(databaseDir, 'user_organizations.jsonl'), userOrgs);
  manifest.database.tables['user_organizations'] = userOrgCount;
  console.log(`  - user_organizations: ${userOrgCount} records`);

  // Sessions
  const sessions = await prisma.session.findMany();
  const sessionCount = await writeJsonl(join(databaseDir, 'sessions.jsonl'), sessions);
  manifest.database.tables['sessions'] = sessionCount;
  console.log(`  - sessions: ${sessionCount} records`);

  // Rooms
  const rooms = await prisma.room.findMany();
  const roomCount = await writeJsonl(join(databaseDir, 'rooms.jsonl'), rooms);
  manifest.database.tables['rooms'] = roomCount;
  console.log(`  - rooms: ${roomCount} records`);

  // Folders
  const folders = await prisma.folder.findMany();
  const folderCount = await writeJsonl(join(databaseDir, 'folders.jsonl'), folders);
  manifest.database.tables['folders'] = folderCount;
  console.log(`  - folders: ${folderCount} records`);

  // Documents
  const documents = await prisma.document.findMany();
  const docCount = await writeJsonl(join(databaseDir, 'documents.jsonl'), documents);
  manifest.database.tables['documents'] = docCount;
  console.log(`  - documents: ${docCount} records`);

  // DocumentVersions
  const versions = await prisma.documentVersion.findMany();
  const versionCount = await writeJsonl(join(databaseDir, 'document_versions.jsonl'), versions);
  manifest.database.tables['document_versions'] = versionCount;
  console.log(`  - document_versions: ${versionCount} records`);

  // FileBlobs
  const blobs = await prisma.fileBlob.findMany();
  const blobCount = await writeJsonl(join(databaseDir, 'file_blobs.jsonl'), blobs);
  manifest.database.tables['file_blobs'] = blobCount;
  console.log(`  - file_blobs: ${blobCount} records`);

  // Groups
  const groups = await prisma.group.findMany();
  const groupCount = await writeJsonl(join(databaseDir, 'groups.jsonl'), groups);
  manifest.database.tables['groups'] = groupCount;
  console.log(`  - groups: ${groupCount} records`);

  // GroupMemberships
  const memberships = await prisma.groupMembership.findMany();
  const membershipCount = await writeJsonl(
    join(databaseDir, 'group_memberships.jsonl'),
    memberships
  );
  manifest.database.tables['group_memberships'] = membershipCount;
  console.log(`  - group_memberships: ${membershipCount} records`);

  // Permissions
  const permissions = await prisma.permission.findMany();
  const permCount = await writeJsonl(join(databaseDir, 'permissions.jsonl'), permissions);
  manifest.database.tables['permissions'] = permCount;
  console.log(`  - permissions: ${permCount} records`);

  // Links
  const links = await prisma.link.findMany();
  const linkCount = await writeJsonl(join(databaseDir, 'links.jsonl'), links);
  manifest.database.tables['links'] = linkCount;
  console.log(`  - links: ${linkCount} records`);

  // Events
  const events = await prisma.event.findMany();
  const eventCount = await writeJsonl(join(databaseDir, 'events.jsonl'), events);
  manifest.database.tables['events'] = eventCount;
  console.log(`  - events: ${eventCount} records`);

  // Calculate total records
  manifest.database.totalRecords = Object.values(manifest.database.tables).reduce(
    (a, b) => a + b,
    0
  );

  // Export storage files
  console.log('Exporting storage files...');
  const storageRoot = process.env['STORAGE_LOCAL_PATH'] ?? join(process.cwd(), 'storage');

  if (existsSync(storageRoot)) {
    const { files, bytes } = copyDirRecursive(storageRoot, storageDir);
    manifest.storage.files = files;
    manifest.storage.totalBytes = bytes;
    console.log(`  - ${files} files (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.log('  - No storage directory found, skipping');
  }

  // Write manifest
  const manifestPath = join(backupDir, 'manifest.json');
  const manifestContent = JSON.stringify(manifest, null, 2);
  const manifestStream = createWriteStream(manifestPath);
  manifestStream.write(manifestContent);
  manifestStream.end();

  console.log('\nBackup complete!');
  console.log(`  Location: ${backupDir}`);
  console.log(`  Database: ${manifest.database.totalRecords} total records`);
  console.log(
    `  Storage: ${manifest.storage.files} files (${(manifest.storage.totalBytes / 1024 / 1024).toFixed(2)} MB)`
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Backup failed:', error);
  process.exit(1);
});
