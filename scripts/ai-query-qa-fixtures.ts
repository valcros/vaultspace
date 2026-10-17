/**
 * Guarded synthetic fixture loader for the shared VaultSpace staging database.
 * It never truncates a table and never touches an organization outside the
 * two exact fixture slugs in qa/ai-query/fixture-manifest.json.
 *
 * Usage:
 *   npx tsx scripts/ai-query-qa-fixtures.ts --plan
 *   AI_QA_APPLY=synthetic-staging-only npx tsx scripts/ai-query-qa-fixtures.ts --apply
 *   npx tsx scripts/ai-query-qa-fixtures.ts --verify
 *   npx tsx scripts/ai-query-qa-fixtures.ts --remove-plan
 *   AI_QA_REMOVE=remove-synthetic-fixtures npx tsx scripts/ai-query-qa-fixtures.ts --remove
 *
 * For --apply/--verify/--remove, provide the staging DATABASE_URL and
 * DATABASE_URL_ADMIN via an in-memory process environment. --apply also needs
 * REDIS_URL and AZURE_STORAGE_ACCOUNT_KEY. Never write these to a file.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  PrismaClient,
  type Document,
  type Organization,
  type Room,
  type User,
} from '@prisma/client';

import { db, withOrgContext } from '../src/lib/db';
import { createEventBus } from '../src/lib/events/EventBus';
import { getPermissionEngine } from '../src/lib/permissions';
import { AzureBlobStorageProvider } from '../src/providers/storage/AzureBlobStorageProvider';
import { BullMQJobProvider } from '../src/providers/job/BullMQJobProvider';
import { DocumentService } from '../src/services/DocumentService';
import type { ServiceContext } from '../src/services/types';
import { DOCUMENT_SCAN_JOB_OPTIONS } from '../src/workers/types';

type OrgKey = 'primary' | 'isolation';
type FixtureManifest = {
  fixtureSet: string;
  version: string;
  organizations: Array<{ key: OrgKey; name: string; slug: string }>;
  users: Array<{ key: string; email: string; organization: OrgKey; role: 'ADMIN' | 'VIEWER' }>;
  rooms: Array<{
    key: string;
    organization: OrgKey;
    name: string;
    slug: string;
    status: 'ACTIVE' | 'DRAFT';
    mode: 'INDEPENDENT';
  }>;
  documents: Array<{
    key: string;
    room: string;
    asset: string;
    mimeType: string;
    indexExpected: boolean;
    laterVersionAsset?: string;
  }>;
  grants: Array<{ room: string; user: string; level: 'VIEW' }>;
  documentDenies: Array<{ document: string; user: string; level: 'NONE' }>;
  links: Array<{
    key: string;
    room: string;
    document?: string;
    slug: string;
    scope: 'ENTIRE_ROOM' | 'DOCUMENT';
  }>;
};

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'qa/ai-query/fixture-manifest.json');
const GOLDEN_PATH = path.join(ROOT, 'qa/ai-query/golden-questions.json');
const RUBRIC_PATH = path.join(ROOT, 'qa/ai-query/evaluation-rubric.json');
const EXPECTED_DATABASE = 'vaultspace';
const SYNTHETIC_HASH = 'synthetic-no-login-credential';
const MARKER = 'vaultspace-ai-query-phase0';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function assertStagingEnvironment(requireStorage: boolean, requireRedis: boolean): void {
  const app = process.env['DATABASE_URL'];
  const admin = process.env['DATABASE_URL_ADMIN'];
  const expectedHost = process.env['AI_QA_STAGING_DB_HOST'];
  assert(
    expectedHost?.endsWith('.postgres.database.azure.com') && expectedHost.includes('staging'),
    'A discovered staging PostgreSQL host is required'
  );
  assert(app && admin, 'DATABASE_URL and DATABASE_URL_ADMIN are required');
  for (const [label, value] of [
    ['DATABASE_URL', app],
    ['DATABASE_URL_ADMIN', admin],
  ] as const) {
    const parsed = new URL(value);
    assert(parsed.hostname === expectedHost, `${label} host is not the discovered staging host`);
    assert(parsed.pathname.slice(1) === EXPECTED_DATABASE, `${label} database is not staging`);
  }
  assert(
    process.env['AI_QA_SUBSCRIPTION_ID'] === '041a67eb-fec8-41a4-9d70-c35863268cd6',
    'AI_QA_SUBSCRIPTION_ID must identify Munger subscription 1'
  );
  assert(
    process.env['ENABLE_RLS'] === 'true',
    'ENABLE_RLS=true is required for shared staging access'
  );
  if (requireStorage) {
    assert(
      process.env['AZURE_STORAGE_ACCOUNT_NAME']?.includes('vaultspace') &&
        process.env['AZURE_STORAGE_ACCOUNT_NAME']?.includes('staging'),
      'A discovered VaultSpace staging storage account is required'
    );
    assert(process.env['AZURE_STORAGE_ACCOUNT_KEY'], 'AZURE_STORAGE_ACCOUNT_KEY is required');
  }
  if (requireRedis) assert(process.env['REDIS_URL'], 'REDIS_URL is required');
}

async function readManifest(): Promise<FixtureManifest> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as FixtureManifest;
  const golden = JSON.parse(await readFile(GOLDEN_PATH, 'utf8')) as {
    fixtureSet: string;
    version: string;
    questions: Array<{ id: string; sources: string[] }>;
  };
  const rubric = JSON.parse(await readFile(RUBRIC_PATH, 'utf8')) as {
    fixtureSet: string;
    version: string;
  };
  assert(manifest.fixtureSet === MARKER, 'Unexpected fixture marker');
  assert(
    golden.fixtureSet === MARKER && golden.version === manifest.version,
    'Golden question set does not match manifest'
  );
  assert(
    rubric.fixtureSet === MARKER && rubric.version === manifest.version,
    'Evaluation rubric does not match manifest'
  );
  assert(
    manifest.organizations.length === 2 && manifest.rooms.length === 7,
    'Fixture organization or room count changed without review'
  );
  const documents = new Set(manifest.documents.map((item) => item.key));
  assert(documents.size === manifest.documents.length, 'Duplicate fixture document key');
  for (const question of golden.questions) {
    for (const source of question.sources) {
      assert(documents.has(source), `Unknown source in ${question.id}`);
    }
  }
  for (const document of manifest.documents) {
    await readFile(path.join(ROOT, 'qa/ai-query', document.asset));
    if (document.laterVersionAsset) {
      await readFile(path.join(ROOT, 'qa/ai-query', document.laterVersionAsset));
    }
  }
  return manifest;
}

async function createOrganizations(admin: PrismaClient, manifest: FixtureManifest) {
  const result = new Map<OrgKey, Organization>();
  for (const item of manifest.organizations) {
    const existing = await admin.organization.findUnique({ where: { slug: item.slug } });
    assert(!existing || existing.name === item.name, `Organization slug collision: ${item.slug}`);
    const organization =
      existing ??
      (await admin.organization.create({
        data: {
          name: item.name,
          slug: item.slug,
          allowSelfSignup: false,
          companyLibraryEnabled: false,
        },
      }));
    result.set(item.key, organization);
  }
  return result;
}

async function createUsers(
  admin: PrismaClient,
  manifest: FixtureManifest,
  organizations: Map<OrgKey, Organization>
) {
  const result = new Map<string, User>();
  for (const item of manifest.users) {
    const existing = await admin.user.findUnique({ where: { email: item.email } });
    assert(
      !existing || existing.passwordHash === SYNTHETIC_HASH,
      `User email collision: ${item.email}`
    );
    const user =
      existing ??
      (await admin.user.create({
        data: {
          email: item.email,
          passwordHash: SYNTHETIC_HASH,
          firstName: 'AI QA',
          lastName: item.key,
          isActive: true,
        },
      }));
    const organizationId = organizations.get(item.organization)!.id;
    await admin.userOrganization.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      create: {
        organizationId,
        userId: user.id,
        role: item.role,
        canManageRooms: item.role === 'ADMIN',
        canManageUsers: item.role === 'ADMIN',
      },
      update: {},
    });
    result.set(item.key, user);
  }
  return result;
}

async function createRooms(
  admin: PrismaClient,
  manifest: FixtureManifest,
  organizations: Map<OrgKey, Organization>
) {
  const result = new Map<string, Room>();
  for (const item of manifest.rooms) {
    const organizationId = organizations.get(item.organization)!.id;
    const existing = await admin.room.findUnique({
      where: { organizationId_slug: { organizationId, slug: item.slug } },
    });
    assert(
      !existing || (existing.name === item.name && existing.mode === item.mode),
      `Room slug collision: ${item.slug}`
    );
    const room =
      existing ??
      (await admin.room.create({
        data: {
          organizationId,
          name: item.name,
          slug: item.slug,
          status: item.status,
          mode: item.mode,
          requiresEmailVerification: false,
        },
      }));
    result.set(item.key, room);
  }
  return result;
}

function uploadContext(
  organization: Organization,
  owner: User,
  storage: AzureBlobStorageProvider,
  jobs: BullMQJobProvider
): ServiceContext {
  return {
    session: {
      sessionId: `ai-qa-fixture-${owner.id}`,
      userId: owner.id,
      organizationId: organization.id,
      user: {
        id: owner.id,
        email: owner.email,
        firstName: owner.firstName,
        lastName: owner.lastName,
        isActive: true,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: 'ADMIN',
        canManageUsers: true,
        canManageRooms: true,
      },
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    requestId: `ai-qa-fixture-${Date.now()}`,
    eventBus: createEventBus(organization.id, {
      actorId: owner.id,
      actorEmail: owner.email,
      actorType: 'ADMIN',
    }),
    providers: { storage, job: jobs } as unknown as ServiceContext['providers'],
  };
}

async function createDocuments(
  admin: PrismaClient,
  manifest: FixtureManifest,
  organizations: Map<OrgKey, Organization>,
  rooms: Map<string, Room>,
  users: Map<string, User>,
  storage: AzureBlobStorageProvider,
  jobs: BullMQJobProvider
) {
  const result = new Map<string, Document>();
  const service = new DocumentService();
  for (const item of manifest.documents) {
    const room = rooms.get(item.room)!;
    const organization = [...organizations.values()].find((org) => org.id === room.organizationId)!;
    const owner =
      room.organizationId === organizations.get('primary')!.id
        ? users.get('owner')!
        : users.get('isolationOwner')!;
    const filename = path.basename(item.asset);
    const bytes = await readFile(path.join(ROOT, 'qa/ai-query', item.asset));
    const existing = await admin.document.findFirst({
      where: { organizationId: room.organizationId, roomId: room.id, name: filename },
    });
    if (existing) {
      const metadata = existing.customMetadata as Record<string, unknown> | null;
      assert(
        metadata?.['fixtureSet'] === MARKER && metadata?.['fixtureKey'] === item.key,
        `Document name collision: ${item.key}`
      );
      const version = await admin.documentVersion.findFirst({
        where: { documentId: existing.id, versionNumber: 1 },
      });
      assert(version?.fileSha256 === sha256(bytes), `Fixture bytes changed: ${item.key}`);
      result.set(item.key, existing);
      continue;
    }
    assert(room.status === 'ACTIVE', `Cannot upload into draft room: ${item.room}`);
    const uploaded = await service.upload(uploadContext(organization, owner, storage, jobs), {
      roomId: room.id,
      file: { filename, mimeType: item.mimeType, size: bytes.length, data: bytes },
      tags: ['synthetic-ai-qa'],
    });
    const document = await admin.document.update({
      where: { id: uploaded.id },
      data: {
        customMetadata: {
          fixtureSet: MARKER,
          fixtureKey: item.key,
          manifestVersion: manifest.version,
        },
      },
    });
    result.set(item.key, document);
  }
  return result;
}

async function createAccess(
  admin: PrismaClient,
  manifest: FixtureManifest,
  rooms: Map<string, Room>,
  users: Map<string, User>,
  documents: Map<string, Document>
) {
  for (const grant of manifest.grants) {
    const room = rooms.get(grant.room)!;
    const user = users.get(grant.user)!;
    const where = {
      organizationId: room.organizationId,
      resourceType: 'ROOM' as const,
      roomId: room.id,
      granteeType: 'USER' as const,
      userId: user.id,
      permissionLevel: grant.level,
      isActive: true,
    };
    if (!(await admin.permission.findFirst({ where })))
      await admin.permission.create({ data: where });
  }
  for (const deny of manifest.documentDenies) {
    const document = documents.get(deny.document)!;
    const user = users.get(deny.user)!;
    const where = {
      organizationId: document.organizationId,
      resourceType: 'DOCUMENT' as const,
      roomId: document.roomId,
      documentId: document.id,
      granteeType: 'USER' as const,
      userId: user.id,
      permissionLevel: deny.level,
      isActive: true,
    };
    if (!(await admin.permission.findFirst({ where })))
      await admin.permission.create({ data: where });
  }
  for (const link of manifest.links) {
    const room = rooms.get(link.room)!;
    const existing = await admin.link.findUnique({ where: { slug: link.slug } });
    assert(
      !existing ||
        (existing.organizationId === room.organizationId &&
          existing.roomId === room.id &&
          existing.scope === link.scope),
      `Link slug collision: ${link.slug}`
    );
    if (!existing)
      await admin.link.create({
        data: {
          organizationId: room.organizationId,
          roomId: room.id,
          slug: link.slug,
          name: `Synthetic AI QA ${link.key}`,
          permission: 'VIEW',
          scope: link.scope,
          scopedDocumentId: link.document ? documents.get(link.document)!.id : null,
          requiresEmailVerification: false,
          isActive: true,
        },
      });
  }
}

async function advanceVersion(
  admin: PrismaClient,
  manifest: FixtureManifest,
  documents: Map<string, Document>,
  storage: AzureBlobStorageProvider,
  jobs: BullMQJobProvider,
  owner: User
) {
  const item = manifest.documents.find((document) => document.laterVersionAsset);
  assert(item?.laterVersionAsset, 'No version-lifecycle fixture configured');
  const document = documents.get(item.key)!;
  const bytes = await readFile(path.join(ROOT, 'qa/ai-query', item.laterVersionAsset));
  const fileSha256 = sha256(bytes);
  const existing = await admin.documentVersion.findFirst({
    where: { documentId: document.id, versionNumber: 2 },
  });
  if (existing) {
    assert(existing.fileSha256 === fileSha256, 'Version 2 fixture bytes changed');
    assert(document.currentVersionId === existing.id, 'Version 2 is not current');
    return;
  }
  const parent = await admin.documentVersion.findFirstOrThrow({
    where: { documentId: document.id, versionNumber: 1 },
  });
  const fileName = path.basename(item.laterVersionAsset);
  const versionHash = createHash('sha256')
    .update(`${fileSha256}:${parent.versionHash}:2`)
    .digest('hex');
  let storageKey = '';
  let committed = false;
  try {
    const version = await admin.$transaction(async (tx) => {
      const next = await tx.documentVersion.create({
        data: {
          organizationId: document.organizationId,
          documentId: document.id,
          versionNumber: 2,
          fileName,
          mimeType: item.mimeType,
          fileSize: BigInt(bytes.length),
          fileSha256,
          versionHash,
          parentVersionHash: parent.versionHash,
          scanStatus: 'PENDING',
          previewStatus: 'PENDING',
          uploadedByUserId: owner.id,
          uploadedByEmail: owner.email,
        },
      });
      storageKey = `${document.organizationId}/documents/${document.id}/versions/${next.id}/original/${fileName}`;
      await storage.put('documents', storageKey, bytes);
      await tx.fileBlob.create({
        data: {
          organizationId: document.organizationId,
          versionId: next.id,
          storageKey,
          storageBucket: 'documents',
          isEncrypted: false,
        },
      });
      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: next.id, totalVersions: 2 },
      });
      return next;
    });
    committed = true;
    await jobs.addJob(
      'high',
      'document.scan',
      {
        documentId: document.id,
        versionId: version.id,
        organizationId: document.organizationId,
        storageKey,
        contentType: item.mimeType,
        fileName,
        fileSizeBytes: bytes.length,
      },
      DOCUMENT_SCAN_JOB_OPTIONS
    );
  } catch (error) {
    if (storageKey && !committed) {
      await storage.delete('documents', storageKey).catch(() => undefined);
    }
    throw error;
  }
}

async function verify(admin: PrismaClient, manifest: FixtureManifest) {
  const organizations = new Map<OrgKey, Organization>();
  for (const item of manifest.organizations) {
    const org = await admin.organization.findUnique({ where: { slug: item.slug } });
    assert(org?.name === item.name, `Missing synthetic organization ${item.key}`);
    organizations.set(item.key, org);
  }
  const users = new Map<string, User>();
  for (const item of manifest.users) {
    const user = await admin.user.findUnique({ where: { email: item.email } });
    assert(user?.passwordHash === SYNTHETIC_HASH, `Missing synthetic user ${item.key}`);
    users.set(item.key, user);
  }
  const rooms = new Map<string, Room>();
  for (const item of manifest.rooms) {
    const room = await admin.room.findUnique({
      where: {
        organizationId_slug: {
          organizationId: organizations.get(item.organization)!.id,
          slug: item.slug,
        },
      },
    });
    assert(room?.name === item.name, `Missing synthetic room ${item.key}`);
    rooms.set(item.key, room);
  }
  const documents = new Map<string, Document>();
  const scanSummary: Record<string, number> = {};
  for (const item of manifest.documents) {
    const room = rooms.get(item.room)!;
    const document = await admin.document.findFirst({
      where: {
        roomId: room.id,
        organizationId: room.organizationId,
        customMetadata: { path: ['fixtureKey'], equals: item.key },
      },
    });
    assert(document, `Missing synthetic document ${item.key}`);
    const version = await admin.documentVersion.findUniqueOrThrow({
      where: { id: document.currentVersionId! },
    });
    scanSummary[version.scanStatus] = (scanSummary[version.scanStatus] ?? 0) + 1;
    documents.set(item.key, document);
  }
  const full = users.get('full')!;
  const partial = users.get('partial')!;
  const outsider = users.get('outsider')!;
  const isolation = users.get('isolation')!;
  const checks: Array<[string, boolean, User, Document]> = [
    ['full briefing', true, full, documents.get('briefing')!],
    ['partial public', true, partial, documents.get('splitPublic')!],
    ['partial restricted', false, partial, documents.get('splitRestricted')!],
    ['outsider briefing', false, outsider, documents.get('briefing')!],
    ['cross-tenant', false, full, documents.get('otherTenant')!],
    ['isolation own', true, isolation, documents.get('otherTenant')!],
  ];
  for (const [label, expected, user, document] of checks) {
    const actual = await withOrgContext(document.organizationId, (tx) =>
      getPermissionEngine().can(
        { userId: user.id },
        'view',
        {
          type: 'DOCUMENT',
          organizationId: document.organizationId,
          roomId: document.roomId,
          folderId: document.folderId ?? undefined,
          documentId: document.id,
        },
        tx
      )
    );
    assert(actual === expected, `Permission baseline mismatch: ${label}`);
  }
  const linkChecks: Array<[string, boolean, string, Document]> = [
    ['room-wide link', true, 'ai-qa-entire-room', documents.get('external')!],
    ['document link', true, 'ai-qa-single-document', documents.get('external')!],
    ['document link outside room', false, 'ai-qa-single-document', documents.get('briefing')!],
  ];
  for (const [label, expected, slug, document] of linkChecks) {
    const link = await admin.link.findUniqueOrThrow({ where: { slug } });
    const actual = await withOrgContext(document.organizationId, (tx) =>
      getPermissionEngine().can(
        { linkId: link.id },
        'view',
        {
          type: 'DOCUMENT',
          organizationId: document.organizationId,
          roomId: document.roomId,
          folderId: document.folderId ?? undefined,
          documentId: document.id,
        },
        tx
      )
    );
    assert(actual === expected, `Link baseline mismatch: ${label}`);
  }
  const currentLifecycle = await admin.documentVersion.findUniqueOrThrow({
    where: { id: documents.get('lifecycle')!.currentVersionId! },
  });
  assert(currentLifecycle.versionNumber === 2, 'Lifecycle fixture must have current version 2');
  const searchRows = await admin.searchIndex.count({
    where: {
      organizationId: organizations.get('primary')!.id,
    },
  });
  console.log(
    JSON.stringify({
      fixtureSet: MARKER,
      version: manifest.version,
      organizations: organizations.size,
      rooms: rooms.size,
      users: users.size,
      documents: documents.size,
      currentVersionScanStatus: scanSummary,
      primarySearchRows: searchRows,
      permissionChecks: checks.length,
      linkChecks: linkChecks.length,
      status: 'baseline-passed',
    })
  );
}

async function buildRemovalPlan(admin: PrismaClient, manifest: FixtureManifest) {
  const slugs = manifest.organizations.map((org) => org.slug);
  const organizations = await admin.organization.findMany({ where: { slug: { in: slugs } } });
  assert(organizations.length === 2, 'Both exact synthetic organizations must exist');
  const expectedUsers = new Set(manifest.users.map((item) => item.email));
  const allBlobs: Array<{ storageBucket: string; storageKey: string }> = [];
  for (const org of organizations) {
    assert(
      manifest.organizations.some((item) => item.slug === org.slug && item.name === org.name),
      'Fixture organization identity mismatch'
    );
    const expectedRooms = manifest.rooms.filter((item) =>
      manifest.organizations.some(
        (candidate) => candidate.key === item.organization && candidate.slug === org.slug
      )
    );
    const actualRooms = await admin.room.findMany({
      where: { organizationId: org.id },
      select: { slug: true },
    });
    assert(
      actualRooms.length === expectedRooms.length &&
        actualRooms.every((room) => expectedRooms.some((item) => item.slug === room.slug)),
      `Organization ${org.slug} contains a non-fixture room`
    );
    const count = await admin.document.count({ where: { organizationId: org.id } });
    const marked = await admin.document.count({
      where: {
        organizationId: org.id,
        customMetadata: { path: ['fixtureSet'], equals: MARKER },
      },
    });
    const expectedDocuments = manifest.documents.filter((item) =>
      expectedRooms.some((room) => room.key === item.room)
    ).length;
    assert(
      count === marked && count === expectedDocuments,
      `Organization ${org.slug} contains non-fixture documents`
    );
    const memberships = await admin.userOrganization.findMany({
      where: { organizationId: org.id },
      include: { user: { select: { email: true } } },
    });
    assert(
      memberships.every((member) => expectedUsers.has(member.user.email)),
      `Organization ${org.slug} contains a non-fixture member`
    );
    const blobs = await admin.fileBlob.findMany({
      where: { organizationId: org.id },
      select: { storageBucket: true, storageKey: true },
    });
    for (const blob of blobs) {
      assert(
        blob.storageKey.startsWith(`${org.id}/documents/`),
        'Unexpected storage key outside fixture organization'
      );
      allBlobs.push(blob);
    }
  }
  const users: User[] = [];
  for (const user of manifest.users) {
    const record = await admin.user.findUnique({ where: { email: user.email } });
    assert(record?.passwordHash === SYNTHETIC_HASH, `Synthetic user ${user.key} identity mismatch`);
    const memberships = await admin.userOrganization.findMany({
      where: { userId: record.id },
      select: { organizationId: true },
    });
    assert(
      memberships.every((member) => organizations.some((org) => org.id === member.organizationId)),
      `Synthetic user ${user.key} has another membership`
    );
    users.push(record);
  }
  return { organizations, users, blobs: allBlobs };
}

async function remove(
  admin: PrismaClient,
  manifest: FixtureManifest,
  storage: AzureBlobStorageProvider
) {
  const plan = await buildRemovalPlan(admin, manifest);
  await admin.$transaction(
    async (tx) => {
      for (const org of plan.organizations) {
        await tx.organization.delete({ where: { id: org.id } });
      }
      for (const user of plan.users) {
        await tx.user.delete({ where: { id: user.id } });
      }
    },
    { timeout: 120_000 }
  );
  let failedBlobs = 0;
  for (const blob of plan.blobs) {
    try {
      await storage.delete(blob.storageBucket, blob.storageKey);
    } catch {
      failedBlobs += 1;
    }
  }
  console.log(
    JSON.stringify({
      fixtureSet: MARKER,
      status: 'removed',
      organizations: plan.organizations.length,
      blobs: plan.blobs.length,
      failedBlobDeletes: failedBlobs,
    })
  );
  assert(failedBlobs === 0, 'Fixture database removed but some synthetic blobs need cleanup');
}

async function main() {
  const command = process.argv[2] ?? '--plan';
  assert(
    ['--plan', '--apply', '--verify', '--remove-plan', '--remove'].includes(command),
    'Use --plan, --apply, --verify, --remove-plan, or --remove'
  );
  const manifest = await readManifest();
  if (command === '--plan') {
    console.log(
      JSON.stringify({
        fixtureSet: MARKER,
        version: manifest.version,
        organizations: manifest.organizations.map((item) => item.slug),
        rooms: manifest.rooms.length,
        documents: manifest.documents.length,
        goldenQuestions: JSON.parse(await readFile(GOLDEN_PATH, 'utf8')).questions.length,
        mutation: 'none',
      })
    );
    return;
  }
  assertStagingEnvironment(command === '--apply' || command === '--remove', command === '--apply');
  const admin = new PrismaClient({
    datasources: {
      db: {
        url: process.env['DATABASE_URL_ADMIN']!,
      },
    },
  });
  let jobs: BullMQJobProvider | undefined;
  try {
    if (command === '--verify') {
      await verify(admin, manifest);
      return;
    }
    if (command === '--remove-plan') {
      const plan = await buildRemovalPlan(admin, manifest);
      console.log(
        JSON.stringify({
          fixtureSet: MARKER,
          status: 'remove-plan-only',
          organizations: plan.organizations.length,
          users: plan.users.length,
          blobs: plan.blobs.length,
          mutation: 'none',
        })
      );
      return;
    }
    const storage = new AzureBlobStorageProvider({
      accountName: process.env['AZURE_STORAGE_ACCOUNT_NAME']!,
      accountKey: process.env['AZURE_STORAGE_ACCOUNT_KEY']!,
    });
    if (command === '--remove') {
      assert(
        process.env['AI_QA_REMOVE'] === 'remove-synthetic-fixtures',
        'AI_QA_REMOVE acknowledgement is required'
      );
      await remove(admin, manifest, storage);
      return;
    }
    assert(
      process.env['AI_QA_APPLY'] === 'synthetic-staging-only',
      'AI_QA_APPLY acknowledgement is required'
    );
    jobs = new BullMQJobProvider({ redisUrl: process.env['REDIS_URL'] });
    const organizations = await createOrganizations(admin, manifest);
    const users = await createUsers(admin, manifest, organizations);
    const rooms = await createRooms(admin, manifest, organizations);
    const documents = await createDocuments(
      admin,
      manifest,
      organizations,
      rooms,
      users,
      storage,
      jobs
    );
    await createAccess(admin, manifest, rooms, users, documents);
    await advanceVersion(admin, manifest, documents, storage, jobs, users.get('owner')!);
    await verify(admin, manifest);
  } finally {
    await jobs?.close();
    await admin.$disconnect();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    '[AI QA fixtures] operation failed:',
    error instanceof Error ? error.message : 'unknown'
  );
  process.exitCode = 1;
});
