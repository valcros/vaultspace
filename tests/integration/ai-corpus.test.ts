import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { readAiRoomCoverage } from '@/lib/ai/coverage';
import { aiIndexInputFingerprint } from '@/lib/ai/indexFingerprint';
import { indexAiVersion } from '@/lib/ai/indexer';
import { reconcileAiRoom } from '@/lib/ai/reconciliation';
import { withOrgContext, db } from '@/lib/db';

import { prisma } from '../../vitest.integration.setup';

const { addJobMock, storageGetMock } = vi.hoisted(() => ({
  addJobMock: vi.fn().mockResolvedValue(undefined),
  storageGetMock: vi.fn(),
}));
vi.mock('@/providers', () => ({
  getProviders: () => ({ job: { addJob: addJobMock }, storage: { get: storageGetMock } }),
}));

const fixtureBytes = Buffer.from('Synthetic note');
const fixtureSha = createHash('sha256').update(fixtureBytes).digest('hex');

async function waitForPostgresActivity(
  queryFragment: string,
  waitEventType: string
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND query ILIKE ${`%${queryFragment}%`}
        AND wait_event_type = ${waitEventType}`;
    if (row && row.count > BigInt(0)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`AI_QA_POSTGRES_ACTIVITY_MISSING_${waitEventType}`);
}

async function seed() {
  const suffix = randomUUID();
  const orgA = await prisma.organization.create({
    data: { name: 'AI QA A', slug: `ai-a-${suffix}`, aiEnabled: true },
  });
  const orgB = await prisma.organization.create({
    data: { name: 'AI QA B', slug: `ai-b-${suffix}`, aiEnabled: true },
  });
  const roomA = await prisma.room.create({
    data: {
      organizationId: orgA.id,
      name: 'AI QA',
      slug: `ai-room-${suffix}`,
      status: 'ACTIVE',
      mode: 'INDEPENDENT',
    },
  });
  const roomB = await prisma.room.create({
    data: {
      organizationId: orgB.id,
      name: 'AI QA B',
      slug: `ai-room-b-${suffix}`,
      status: 'ACTIVE',
      mode: 'INDEPENDENT',
    },
  });
  await prisma.aiPolicy.createMany({
    data: [
      { organizationId: orgA.id, roomId: roomA.id, enabled: true },
      { organizationId: orgB.id, roomId: roomB.id, enabled: true },
    ],
  });
  const doc = await prisma.document.create({
    data: {
      organizationId: orgA.id,
      roomId: roomA.id,
      name: 'Synthetic note',
      originalFileName: 'note.txt',
      mimeType: 'text/plain',
      fileSize: BigInt(fixtureBytes.length),
    },
  });
  const version = await prisma.documentVersion.create({
    data: {
      organizationId: orgA.id,
      documentId: doc.id,
      versionNumber: 1,
      fileName: 'note.txt',
      mimeType: 'text/plain',
      fileSize: BigInt(fixtureBytes.length),
      fileSha256: fixtureSha,
      versionHash: 'b'.repeat(64),
      scanStatus: 'CLEAN',
    },
  });
  await prisma.fileBlob.create({
    data: {
      organizationId: orgA.id,
      versionId: version.id,
      storageBucket: 'documents',
      storageKey: `synthetic/${version.id}`,
    },
  });
  await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  const source = await prisma.aiSource.create({
    data: {
      organizationId: orgA.id,
      roomId: roomA.id,
      documentId: doc.id,
      versionId: version.id,
      fileSha256: version.fileSha256,
      contentSha256: 'c'.repeat(64),
      embeddingModelId: 'synthetic-test-model',
      chunkCount: 1,
    },
  });
  await prisma.aiChunk.create({
    data: {
      organizationId: orgA.id,
      roomId: roomA.id,
      sourceId: source.id,
      documentId: doc.id,
      versionId: version.id,
      ordinal: 0,
      content: 'Synthetic financing note',
      contentSha256: 'd'.repeat(64),
      embedding: [1, ...Array(1535).fill(0)],
    },
  });
  return { orgA, orgB, roomA, roomB, doc, version, source };
}

describe('AI corpus database boundary', () => {
  it('builds a stored lexical search vector without weakening tenant isolation', async () => {
    const { orgA, orgB, source } = await seed();
    const rows = await withOrgContext(
      orgA.id,
      (tx) =>
        tx.$queryRaw<Array<{ matches: boolean; rank: number }>>`
        SELECT "contentSearch" @@ plainto_tsquery('english', 'synthetic financing') AS matches,
          ts_rank_cd("contentSearch", plainto_tsquery('english', 'synthetic financing')) AS rank
        FROM ai_chunks WHERE "sourceId" = ${source.id}`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.matches).toBe(true);
    expect(rows[0]?.rank).toBeGreaterThan(0);
    expect(
      await withOrgContext(
        orgB.id,
        (tx) =>
          tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM ai_chunks
          WHERE "sourceId" = ${source.id}
            AND "contentSearch" @@ plainto_tsquery('english', 'synthetic financing')`
      )
    ).toHaveLength(0);
  });

  it('isolates derivative rows and denies direct no-context access', async () => {
    const { orgA, orgB, source } = await seed();
    expect(await withOrgContext(orgA.id, (tx) => tx.aiChunk.count())).toBe(1);
    expect(await withOrgContext(orgB.id, (tx) => tx.aiChunk.count())).toBe(0);
    expect(await db.aiChunk.count()).toBe(0);
    expect(
      await withOrgContext(orgB.id, (tx) => tx.aiSource.findFirst({ where: { id: source.id } }))
    ).toBeNull();
    await expect(
      withOrgContext(orgB.id, (tx) =>
        tx.aiChunk.create({
          data: {
            organizationId: orgA.id,
            roomId: source.roomId,
            sourceId: source.id,
            documentId: source.documentId,
            versionId: source.versionId,
            ordinal: 1,
            content: 'cross-tenant',
            contentSha256: 'e'.repeat(64),
            embedding: [1, ...Array(1535).fill(0)],
          },
        })
      )
    ).rejects.toThrow();
  });

  it('reports complete coverage only for current CLEAN versions', async () => {
    const { orgA, roomA, doc, version } = await seed();
    const complete = await readAiRoomCoverage(orgA.id, roomA.id, 'synthetic-test-model');
    expect(complete).toMatchObject({
      activeDocuments: 1,
      cleanCurrentVersions: 1,
      indexedVersions: 1,
      missingVersions: 0,
      ready: true,
    });
    await prisma.documentVersion.update({
      where: { id: version.id },
      data: { scanStatus: 'ERROR' },
    });
    expect(await prisma.aiSource.count({ where: { versionId: version.id } })).toBe(0);
    expect(await prisma.aiChunk.count({ where: { versionId: version.id } })).toBe(0);
    expect(await readAiRoomCoverage(orgA.id, roomA.id, 'synthetic-test-model')).toMatchObject({
      ready: false,
      cleanCurrentVersions: 0,
      indexedVersions: 0,
      excludedDocuments: 1,
    });
    await prisma.document.update({ where: { id: doc.id }, data: { withdrawnAt: new Date() } });
    expect(await readAiRoomCoverage(orgA.id, roomA.id, 'synthetic-test-model')).toMatchObject({
      activeDocuments: 0,
      ready: false,
    });
  });

  it('distinguishes unsupported active documents from pending index work', async () => {
    const { orgA, roomA, doc, version, source } = await seed();
    await prisma.documentVersion.update({
      where: { id: version.id },
      data: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    });
    expect(await prisma.aiSource.count({ where: { id: source.id } })).toBe(0);
    expect(await readAiRoomCoverage(orgA.id, roomA.id, 'synthetic-test-model')).toMatchObject({
      activeDocuments: 1,
      missingVersions: 1,
      unsupportedDocuments: 1,
      pendingDocuments: 0,
      ready: false,
    });
    await prisma.documentVersion.update({
      where: { id: version.id },
      data: { mimeType: 'text/plain' },
    });
    await prisma.aiIndexJob.create({
      data: {
        organizationId: orgA.id,
        documentId: doc.id,
        versionId: version.id,
        state: 'PENDING',
      },
    });
    expect(await readAiRoomCoverage(orgA.id, roomA.id, 'synthetic-test-model')).toMatchObject({
      pendingDocuments: 1,
      unsupportedDocuments: 0,
      ready: false,
    });
  });

  it('does not let a failed historical version block a fully indexed current version', async () => {
    const { orgA, roomA, doc } = await seed();
    const oldVersion = await prisma.documentVersion.create({
      data: {
        organizationId: orgA.id,
        documentId: doc.id,
        versionNumber: 2,
        fileName: 'old-note.txt',
        mimeType: 'text/plain',
        fileSize: BigInt(12),
        fileSha256: 'e'.repeat(64),
        versionHash: 'f'.repeat(64),
        scanStatus: 'CLEAN',
      },
    });
    await prisma.aiIndexJob.create({
      data: {
        organizationId: orgA.id,
        documentId: doc.id,
        versionId: oldVersion.id,
        state: 'FAILED',
        lastErrorCode: 'AI_FORMAT_UNSUPPORTED',
      },
    });
    expect(await readAiRoomCoverage(orgA.id, roomA.id, 'synthetic-test-model')).toMatchObject({
      indexedVersions: 1,
      failedJobs: 0,
      ready: true,
    });
  });

  it('does not requeue a permanently failed current version during reconciliation', async () => {
    const { orgA, roomA, doc, version, source } = await seed();
    addJobMock.mockClear();
    const blob = await prisma.fileBlob.findUniqueOrThrow({ where: { versionId: version.id } });
    const fingerprint = aiIndexInputFingerprint(
      {
        organizationId: orgA.id,
        roomId: roomA.id,
        documentId: doc.id,
        versionId: version.id,
        fileSha256: version.fileSha256,
        mimeType: version.mimeType,
        blobId: blob.id,
        storageBucket: blob.storageBucket,
        storageKey: blob.storageKey,
      },
      'synthetic-test-model'
    );
    await prisma.aiSource.delete({ where: { id: source.id } });
    await prisma.aiIndexJob.create({
      data: {
        organizationId: orgA.id,
        documentId: doc.id,
        versionId: version.id,
        state: 'FAILED',
        attempts: 1,
        lastErrorCode: 'AI_EMPTY_TEXT',
        failureFingerprint: fingerprint,
      },
    });
    const result = await reconcileAiRoom(orgA.id, roomA.id, 'synthetic-test-model');
    expect(result).toMatchObject({ missingDocuments: 1, failedJobs: 1 });
    expect(
      await prisma.aiIndexJob.findUniqueOrThrow({
        where: { organizationId_versionId: { organizationId: orgA.id, versionId: version.id } },
      })
    ).toMatchObject({ state: 'FAILED', attempts: 1, lastErrorCode: 'AI_EMPTY_TEXT' });
    expect(addJobMock).not.toHaveBeenCalled();

    await prisma.documentVersion.update({
      where: { id: version.id },
      data: { mimeType: 'application/pdf' },
    });
    const repaired = await reconcileAiRoom(orgA.id, roomA.id, 'synthetic-test-model');
    expect(repaired).toMatchObject({ missingDocuments: 1, failedJobs: 0 });
    expect(
      await prisma.aiIndexJob.findUniqueOrThrow({
        where: { organizationId_versionId: { organizationId: orgA.id, versionId: version.id } },
      })
    ).toMatchObject({ state: 'PENDING', lastErrorCode: null, failureFingerprint: null });
    expect(addJobMock).toHaveBeenCalledTimes(1);
  });

  it('allows an explicit retry after a same-metadata source repair', async () => {
    const { orgA, roomA, doc, version, source } = await seed();
    addJobMock.mockClear();
    const blob = await prisma.fileBlob.findUniqueOrThrow({ where: { versionId: version.id } });
    await prisma.aiSource.delete({ where: { id: source.id } });
    await prisma.aiIndexJob.create({
      data: {
        organizationId: orgA.id,
        documentId: doc.id,
        versionId: version.id,
        state: 'FAILED',
        attempts: 1,
        lastErrorCode: 'AI_FILE_CHECKSUM_MISMATCH',
        failureFingerprint: aiIndexInputFingerprint(
          {
            organizationId: orgA.id,
            roomId: roomA.id,
            documentId: doc.id,
            versionId: version.id,
            fileSha256: version.fileSha256,
            mimeType: version.mimeType,
            blobId: blob.id,
            storageBucket: blob.storageBucket,
            storageKey: blob.storageKey,
          },
          'synthetic-test-model'
        ),
      },
    });
    await reconcileAiRoom(orgA.id, roomA.id, 'synthetic-test-model', {
      retryPermanentlyFailed: true,
    });
    expect(
      await prisma.aiIndexJob.findUniqueOrThrow({
        where: { organizationId_versionId: { organizationId: orgA.id, versionId: version.id } },
      })
    ).toMatchObject({ state: 'PENDING', lastErrorCode: null, failureFingerprint: null });
    expect(addJobMock).toHaveBeenCalledTimes(1);
  });

  it('does not commit indexing after a concurrent policy disable during embedding', async () => {
    const { orgA, roomA, doc, version, source } = await seed();
    await prisma.aiSource.delete({ where: { id: source.id } });
    storageGetMock.mockResolvedValueOnce(fixtureBytes);
    let markEmbeddingStarted!: () => void;
    let releaseEmbedding!: () => void;
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve;
    });
    const embeddingBarrier = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    const provider = {
      modelId: 'synthetic-test-model',
      dimensions: 1536,
      embed: vi.fn(async () => {
        markEmbeddingStarted();
        await embeddingBarrier;
        return [[1, ...Array(1535).fill(0)]];
      }),
    };
    const indexing = indexAiVersion(orgA.id, doc.id, version.id, provider);
    await embeddingStarted;
    try {
      await prisma.aiPolicy.update({ where: { roomId: roomA.id }, data: { enabled: false } });
    } finally {
      releaseEmbedding();
    }
    expect(await indexing).toBe('SKIPPED');
    expect(await prisma.aiSource.count({ where: { organizationId: orgA.id } })).toBe(0);
    expect(await prisma.aiChunk.count({ where: { organizationId: orgA.id } })).toBe(0);
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);
  });

  it('purges a completed index when policy disable waits behind the final index write', async () => {
    const { orgA, roomA, doc, version, source } = await seed();
    await prisma.aiSource.delete({ where: { id: source.id } });
    storageGetMock.mockResolvedValueOnce(fixtureBytes);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION public.aiqa_pause_source_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(6); RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER aiqa_pause_source_insert BEFORE INSERT ON ai_sources
      FOR EACH ROW EXECUTE FUNCTION public.aiqa_pause_source_insert()`);
    const provider = {
      modelId: 'synthetic-test-model',
      dimensions: 1536,
      embed: vi.fn().mockResolvedValue([[1, ...Array(1535).fill(0)]]),
    };
    let indexing: Promise<unknown> | undefined;
    let disabling: Promise<unknown> | undefined;
    try {
      indexing = indexAiVersion(orgA.id, doc.id, version.id, provider);
      await waitForPostgresActivity('ai_sources', 'Timeout');
      disabling = prisma.aiPolicy
        .update({
          where: { roomId: roomA.id },
          data: { enabled: false },
        })
        .then((result) => result);
      await waitForPostgresActivity('ai_policies', 'Lock');
      expect(await indexing).toBe('READY');
      await disabling;
      expect(await prisma.aiSource.count({ where: { organizationId: orgA.id } })).toBe(0);
      expect(await prisma.aiChunk.count({ where: { organizationId: orgA.id } })).toBe(0);
      expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);
    } finally {
      await Promise.allSettled([indexing, disabling].filter(Boolean) as Promise<unknown>[]);
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS aiqa_pause_source_insert ON ai_sources'
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS public.aiqa_pause_source_insert()');
    }
  });

  it('purges sources on version change, withdrawal, and policy disable', async () => {
    const first = await seed();
    await prisma.document.update({ where: { id: first.doc.id }, data: { currentVersionId: null } });
    expect(await prisma.aiSource.count({ where: { id: first.source.id } })).toBe(0);
    const second = await seed();
    await prisma.document.update({
      where: { id: second.doc.id },
      data: { withdrawnAt: new Date() },
    });
    expect(await prisma.aiSource.count({ where: { id: second.source.id } })).toBe(0);
    const third = await seed();
    await prisma.aiPolicy.update({ where: { roomId: third.roomA.id }, data: { enabled: false } });
    expect(await prisma.aiSource.count({ where: { id: third.source.id } })).toBe(0);
    const fourth = await seed();
    await prisma.aiPolicy.delete({ where: { roomId: fourth.roomA.id } });
    expect(await prisma.aiSource.count({ where: { id: fourth.source.id } })).toBe(0);
    const fifth = await seed();
    await prisma.organization.update({ where: { id: fifth.orgA.id }, data: { isActive: false } });
    expect(await prisma.aiSource.count({ where: { id: fifth.source.id } })).toBe(0);
    const sixth = await seed();
    await prisma.organization.update({ where: { id: sixth.orgA.id }, data: { aiEnabled: false } });
    expect(await prisma.aiSource.count({ where: { id: sixth.source.id } })).toBe(0);
  });

  it('purges derivatives when the original file reference is removed', async () => {
    const { orgA, roomA, version, source } = await seed();
    await prisma.fileBlob.delete({ where: { versionId: version.id } });
    expect(await prisma.aiSource.count({ where: { id: source.id } })).toBe(0);
    expect(await prisma.aiChunk.count({ where: { sourceId: source.id } })).toBe(0);
    expect(await readAiRoomCoverage(orgA.id, roomA.id, 'synthetic-test-model')).toMatchObject({
      indexedVersions: 0,
      excludedDocuments: 1,
      ready: false,
    });
  });

  it('purges derivatives when a document moves to a different room', async () => {
    const { orgA, doc, source } = await seed();
    const destination = await prisma.room.create({
      data: {
        organizationId: orgA.id,
        name: 'AI QA destination',
        slug: `ai-destination-${randomUUID()}`,
        status: 'ACTIVE',
        mode: 'INDEPENDENT',
      },
    });
    await prisma.document.update({ where: { id: doc.id }, data: { roomId: destination.id } });
    expect(await prisma.aiSource.count({ where: { id: source.id } })).toBe(0);
    expect(await prisma.aiChunk.count({ where: { sourceId: source.id } })).toBe(0);
  });
});
