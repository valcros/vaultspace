/** Guarded synthetic staging fixture for full hybrid retrieval at 5,000 chunks. */
import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { AI_PIPELINE_REVISION, chunkPages, sha256 } from '../src/lib/ai/chunking';
import { readAiRoomCoverage } from '../src/lib/ai/coverage';
import { PostgresRetrievalProvider } from '../src/lib/ai/retrieval';
import { bootstrapDb, db, withOrgContext } from '../src/lib/db';
import { AzureBlobStorageProvider } from '../src/providers/storage/AzureBlobStorageProvider';

const SUBSCRIPTION_ID = '041a67eb-fec8-41a4-9d70-c35863268cd6';
const ORG_SLUG = 'vaultspace-ai-qa-synthetic';
const ORG_NAME = 'VaultSpace AI QA Synthetic';
const OTHER_ORG_SLUG = 'vaultspace-ai-qa-isolation';
const ROOM_SLUG = 'ai-qa-volume-retrieval';
const ROOM_NAME = 'AI QA Volume Retrieval';
const DOCUMENTS = 20;
const CHUNKS_PER_DOCUMENT = 250;
const TOTAL_CHUNKS = DOCUMENTS * CHUNKS_PER_DOCUMENT;
const MODEL_ID = 'vaultspace-embed@1';

function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}

function guard(mode: string) {
  assert(mode === '--prepare' || mode === '--measure', 'AI_VOLUME_MODE_INVALID');
  assert(
    process.env['AI_QA_SUBSCRIPTION_ID'] === SUBSCRIPTION_ID,
    'AI_VOLUME_SUBSCRIPTION_INVALID'
  );
  assert(process.env['ENABLE_RLS'] === 'true', 'AI_VOLUME_RLS_REQUIRED');
  const expectedHost = process.env['AI_QA_STAGING_DB_HOST'];
  assert(
    expectedHost?.includes('staging') && expectedHost.endsWith('.postgres.database.azure.com'),
    'AI_VOLUME_STAGING_HOST_REQUIRED'
  );
  for (const name of ['DATABASE_URL', 'DATABASE_URL_ADMIN']) {
    const raw = process.env[name];
    assert(raw, `AI_VOLUME_${name}_REQUIRED`);
    const target = new URL(raw);
    assert(
      target.hostname === expectedHost && target.pathname === '/vaultspace',
      'AI_VOLUME_DATABASE_INVALID'
    );
  }
  if (mode === '--prepare') {
    assert(
      process.env['AI_QA_VOLUME_CONFIRM'] === 'synthetic-staging-only',
      'AI_VOLUME_APPLY_CONFIRM_REQUIRED'
    );
    assert(
      process.env['AZURE_STORAGE_ACCOUNT_NAME']?.includes('vaultspace') &&
        process.env['AZURE_STORAGE_ACCOUNT_NAME']?.includes('staging') &&
        process.env['AZURE_STORAGE_ACCOUNT_KEY'],
      'AI_VOLUME_STORAGE_CONFIG_REQUIRED'
    );
  }
}

function vector(documentIndex: number, ordinal: number): number[] {
  return Array.from(
    { length: 1536 },
    (_, dimension) => ((documentIndex * 131 + ordinal * 17 + dimension * 73) % 1009) / 1009
  );
}

function syntheticText(documentIndex: number): {
  bytes: Buffer;
  chunks: ReturnType<typeof chunkPages>;
} {
  const unit = `Synthetic QA volume document ${documentIndex}. Cedar Arc telemetry and battery dispatch. No customer data. `;
  const large = unit.repeat(14_000);
  let low = 0;
  let high = large.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const count = chunkPages([{ pageNumber: null, text: large.slice(0, middle) }]).length;
    if (count < CHUNKS_PER_DOCUMENT) low = middle + 1;
    else high = middle;
  }
  const bytes = Buffer.from(large.slice(0, low));
  const chunks = chunkPages([{ pageNumber: null, text: bytes.toString('utf8') }]);
  assert(chunks.length === CHUNKS_PER_DOCUMENT, 'AI_VOLUME_CHUNK_GENERATION_INVALID');
  assert(bytes.length < 25 * 1024 * 1024, 'AI_VOLUME_FILE_TOO_LARGE');
  return { bytes, chunks };
}

async function scope() {
  const organization = await bootstrapDb.organization.findUnique({ where: { slug: ORG_SLUG } });
  assert(
    organization?.name === ORG_NAME && organization.isActive && organization.aiEnabled,
    'AI_VOLUME_ORGANIZATION_INVALID'
  );
  const other = await bootstrapDb.organization.findUnique({ where: { slug: OTHER_ORG_SLUG } });
  assert(other?.name === 'VaultSpace AI QA Isolation', 'AI_VOLUME_OTHER_ORGANIZATION_INVALID');
  return { organization, other };
}

async function prepare(organizationId: string) {
  const existingRoom = await bootstrapDb.room.findFirst({
    where: { organizationId, slug: ROOM_SLUG },
  });
  assert(!existingRoom || existingRoom.name === ROOM_NAME, 'AI_VOLUME_ROOM_COLLISION');
  const room =
    existingRoom ??
    (await bootstrapDb.room.create({
      data: {
        organizationId,
        name: ROOM_NAME,
        slug: ROOM_SLUG,
        status: 'ACTIVE',
        mode: 'INDEPENDENT',
        requiresEmailVerification: true,
      },
    }));
  assert(room.status === 'ACTIVE' && room.mode === 'INDEPENDENT', 'AI_VOLUME_ROOM_INACTIVE');
  const existingPolicy = await bootstrapDb.aiPolicy.findUnique({ where: { roomId: room.id } });
  if (!existingPolicy) {
    await bootstrapDb.aiPolicy.create({ data: { organizationId, roomId: room.id, enabled: true } });
  } else {
    assert(
      existingPolicy.organizationId === organizationId && existingPolicy.enabled,
      'AI_VOLUME_POLICY_INVALID'
    );
  }
  const storage = new AzureBlobStorageProvider({
    accountName: process.env['AZURE_STORAGE_ACCOUNT_NAME']!,
    accountKey: process.env['AZURE_STORAGE_ACCOUNT_KEY']!,
  });
  for (let documentIndex = 0; documentIndex < DOCUMENTS; documentIndex++) {
    const suffix = String(documentIndex).padStart(2, '0');
    const documentId = `aiqa-volume-doc-${suffix}`;
    const versionId = `aiqa-volume-version-${suffix}`;
    const sourceId = `aiqa-volume-source-${suffix}`;
    const storageKey = `${organizationId}/aiqa-volume/${documentId}.txt`;
    const { bytes, chunks } = syntheticText(documentIndex);
    const fileSha256 = sha256(bytes);
    await storage.put('documents', storageKey, bytes);
    const document = await bootstrapDb.document.findUnique({ where: { id: documentId } });
    if (!document) {
      await bootstrapDb.document.create({
        data: {
          id: documentId,
          organizationId,
          roomId: room.id,
          name: `Synthetic volume note ${suffix}`,
          originalFileName: `${documentId}.txt`,
          mimeType: 'text/plain',
          fileSize: BigInt(bytes.length),
          customMetadata: { aiQaVolume: true },
        },
      });
    } else {
      assert(
        document.organizationId === organizationId &&
          document.roomId === room.id &&
          document.name === `Synthetic volume note ${suffix}` &&
          document.customMetadata !== null &&
          typeof document.customMetadata === 'object' &&
          !Array.isArray(document.customMetadata) &&
          document.customMetadata['aiQaVolume'] === true,
        'AI_VOLUME_DOCUMENT_COLLISION'
      );
    }
    const version = await bootstrapDb.documentVersion.findUnique({ where: { id: versionId } });
    if (!version) {
      await bootstrapDb.documentVersion.create({
        data: {
          id: versionId,
          organizationId,
          documentId,
          versionNumber: 1,
          fileName: `${documentId}.txt`,
          mimeType: 'text/plain',
          fileSize: BigInt(bytes.length),
          fileSha256,
          versionHash: sha256(`${fileSha256}:1`),
          scanStatus: 'CLEAN',
        },
      });
    } else {
      assert(
        version.organizationId === organizationId &&
          version.documentId === documentId &&
          version.fileSha256 === fileSha256,
        'AI_VOLUME_VERSION_COLLISION'
      );
    }
    const blob = await bootstrapDb.fileBlob.findUnique({ where: { versionId } });
    if (!blob) {
      await bootstrapDb.fileBlob.create({
        data: {
          id: `aiqa-volume-blob-${suffix}`,
          organizationId,
          versionId,
          storageBucket: 'documents',
          storageKey,
        },
      });
    } else {
      assert(
        blob.organizationId === organizationId &&
          blob.storageBucket === 'documents' &&
          blob.storageKey === storageKey,
        'AI_VOLUME_BLOB_COLLISION'
      );
    }
    if (!document?.currentVersionId) {
      await bootstrapDb.document.update({
        where: { id: documentId },
        data: { currentVersionId: versionId, totalVersions: 1 },
      });
    } else {
      assert(document.currentVersionId === versionId, 'AI_VOLUME_CURRENT_VERSION_COLLISION');
    }
    const source = await bootstrapDb.aiSource.findUnique({ where: { versionId } });
    const contentSha256 = sha256(chunks.map((chunk) => chunk.contentSha256).join(':'));
    if (!source) {
      await bootstrapDb.aiSource.create({
        data: {
          id: sourceId,
          organizationId,
          roomId: room.id,
          documentId,
          versionId,
          fileSha256,
          contentSha256,
          embeddingModelId: MODEL_ID,
          pipelineRevision: AI_PIPELINE_REVISION,
          chunkCount: CHUNKS_PER_DOCUMENT,
        },
      });
    } else {
      assert(
        source.id === sourceId &&
          source.organizationId === organizationId &&
          source.roomId === room.id &&
          source.fileSha256 === fileSha256 &&
          source.contentSha256 === contentSha256 &&
          source.embeddingModelId === MODEL_ID &&
          source.pipelineRevision === AI_PIPELINE_REVISION &&
          source.state === 'READY' &&
          source.chunkCount === CHUNKS_PER_DOCUMENT,
        'AI_VOLUME_SOURCE_COLLISION'
      );
    }
    const existingChunks = await bootstrapDb.aiChunk.findMany({
      where: { organizationId, sourceId },
      select: { ordinal: true, contentSha256: true },
    });
    for (const item of existingChunks) {
      assert(
        chunks[item.ordinal]?.contentSha256 === item.contentSha256,
        'AI_VOLUME_EXISTING_CHUNK_COLLISION'
      );
    }
    const existingOrdinals = new Set(existingChunks.map((item) => item.ordinal));
    for (let offset = 0; offset < chunks.length; offset += 50) {
      const data = chunks
        .slice(offset, offset + 50)
        .filter((chunk) => !existingOrdinals.has(chunk.ordinal))
        .map((chunk) => ({
          id: randomUUID(),
          organizationId,
          roomId: room.id,
          sourceId,
          documentId,
          versionId,
          ordinal: chunk.ordinal,
          pageNumber: chunk.pageNumber,
          content: chunk.text,
          contentSha256: chunk.contentSha256,
          embedding: vector(documentIndex, chunk.ordinal),
        }));
      if (data.length) await bootstrapDb.aiChunk.createMany({ data, skipDuplicates: true });
    }
    const count = await bootstrapDb.aiChunk.count({ where: { organizationId, sourceId } });
    assert(count === CHUNKS_PER_DOCUMENT, 'AI_VOLUME_CHUNK_COUNT_INVALID');
  }
  process.stdout.write(
    `${JSON.stringify({ mode: 'prepare', syntheticRoom: ROOM_SLUG, documents: DOCUMENTS, chunks: TOTAL_CHUNKS, modelId: MODEL_ID })}\n`
  );
}

async function measure(organizationId: string, otherOrganizationId: string) {
  const room = await bootstrapDb.room.findFirst({ where: { organizationId, slug: ROOM_SLUG } });
  assert(
    room?.name === ROOM_NAME && room.status === 'ACTIVE' && room.mode === 'INDEPENDENT',
    'AI_VOLUME_ROOM_MISSING'
  );
  const policy = await bootstrapDb.aiPolicy.findUnique({ where: { roomId: room.id } });
  assert(policy?.enabled && policy.organizationId === organizationId, 'AI_VOLUME_POLICY_DISABLED');
  const sources = await bootstrapDb.aiSource.findMany({
    where: { organizationId, roomId: room.id, state: 'READY' },
    select: {
      id: true,
      versionId: true,
      documentId: true,
      chunkCount: true,
      embeddingModelId: true,
    },
    orderBy: { documentId: 'asc' },
  });
  assert(
    sources.length === DOCUMENTS &&
      sources.every(
        (source, index) =>
          source.id === `aiqa-volume-source-${String(index).padStart(2, '0')}` &&
          source.documentId === `aiqa-volume-doc-${String(index).padStart(2, '0')}` &&
          source.versionId === `aiqa-volume-version-${String(index).padStart(2, '0')}` &&
          source.chunkCount === CHUNKS_PER_DOCUMENT &&
          source.embeddingModelId === MODEL_ID
      ),
    'AI_VOLUME_SOURCE_SET_INVALID'
  );
  const chunkCount = await bootstrapDb.aiChunk.count({
    where: { organizationId, roomId: room.id },
  });
  assert(chunkCount === TOTAL_CHUNKS, 'AI_VOLUME_CORPUS_INCOMPLETE');
  const coverage = await readAiRoomCoverage(organizationId, room.id, MODEL_ID);
  assert(
    coverage.ready &&
      coverage.indexedVersions === DOCUMENTS &&
      coverage.activeDocuments === DOCUMENTS,
    'AI_VOLUME_COVERAGE_INCOMPLETE'
  );
  const versionIds = sources.map((source) => source.versionId);
  type EligibleChunk = {
    organizationId: string;
    roomId: string;
    sourceId: string;
    documentId: string;
    versionId: string;
    ordinal: number;
    content: string;
    contentSha256: string;
    dimensions: number | null;
  };
  const eligible = await withOrgContext(
    organizationId,
    (tx) =>
      tx.$queryRaw<EligibleChunk[]>(Prisma.sql`
        SELECT c."organizationId", c."roomId", c."sourceId", c."documentId", c."versionId",
          c.ordinal, c.content, c."contentSha256", array_length(c.embedding, 1) AS dimensions
        FROM ai_chunks c
        JOIN ai_sources s ON s.id = c."sourceId" AND s."organizationId" = c."organizationId"
        JOIN document_versions v ON v.id = c."versionId" AND v."organizationId" = c."organizationId"
        JOIN file_blobs b ON b."versionId" = v.id AND b."organizationId" = c."organizationId"
        JOIN documents d ON d.id = c."documentId" AND d."organizationId" = c."organizationId"
        JOIN rooms r ON r.id = c."roomId" AND r."organizationId" = c."organizationId"
        JOIN organizations o ON o.id = c."organizationId"
        JOIN ai_policies p ON p."roomId" = r.id AND p."organizationId" = c."organizationId"
        WHERE c."organizationId" = ${organizationId} AND c."roomId" = ${room.id}
          AND c."versionId" IN (${Prisma.join(versionIds)})
          AND s.state = 'READY' AND s."versionId" = c."versionId"
          AND s."embeddingModelId" = ${MODEL_ID}
          AND s."pipelineRevision" = ${AI_PIPELINE_REVISION}
          AND s."documentId" = c."documentId" AND s."roomId" = c."roomId"
          AND s."fileSha256" = v."fileSha256"
          AND v."documentId" = d.id AND v."scanStatus" = 'CLEAN'
          AND v."mimeType" = 'text/plain'
          AND d."currentVersionId" = v.id AND d.status = 'ACTIVE'
          AND d."deletedAt" IS NULL AND d."withdrawnAt" IS NULL
          AND (d."expiresAt" IS NULL OR d."expiresAt" > now())
          AND d."roomId" = r.id AND r.status = 'ACTIVE' AND r.mode = 'INDEPENDENT'
          AND o."isActive" = true AND o."aiEnabled" = true AND p.enabled = true`),
    { timeout: 120_000 }
  );
  assert(eligible.length === TOTAL_CHUNKS, 'AI_VOLUME_ELIGIBLE_CORPUS_INCOMPLETE');
  const expectedChunks = Array.from(
    { length: DOCUMENTS },
    (_, index) => syntheticText(index).chunks
  );
  const seen = new Set<string>();
  for (const row of eligible) {
    const documentIndex = Number(row.documentId.slice('aiqa-volume-doc-'.length));
    const suffix = String(documentIndex).padStart(2, '0');
    const expected = expectedChunks[documentIndex]?.[row.ordinal];
    const key = `${row.documentId}:${row.ordinal}`;
    assert(
      row.organizationId === organizationId &&
        row.roomId === room.id &&
        row.sourceId === `aiqa-volume-source-${suffix}` &&
        row.documentId === `aiqa-volume-doc-${suffix}` &&
        row.versionId === `aiqa-volume-version-${suffix}` &&
        row.dimensions === 1536 &&
        expected?.contentSha256 === row.contentSha256 &&
        sha256(row.content) === row.contentSha256 &&
        !seen.has(key),
      'AI_VOLUME_ELIGIBLE_CHUNK_INVALID'
    );
    seen.add(key);
  }
  const retrieval = new PostgresRetrievalProvider();
  const request = {
    organizationId,
    roomId: room.id,
    allowedVersionIds: versionIds,
    question: 'Synthetic telemetry and battery dispatch',
    questionEmbedding: vector(3, 88),
    embeddingModelId: MODEL_ID,
  };
  const scoped = await retrieval.retrieve({
    ...request,
    allowedVersionIds: versionIds.slice(0, 3),
  });
  assert(
    scoped.length > 0 && scoped.every((row) => versionIds.slice(0, 3).includes(row.versionId)),
    'AI_VOLUME_SCOPE_LEAK'
  );
  const crossTenant = await withOrgContext(otherOrganizationId, (tx) =>
    tx.aiChunk.count({ where: { roomId: room.id } })
  );
  assert(crossTenant === 0, 'AI_VOLUME_RLS_LEAK');
  const directNoContext = await db.aiChunk.count({ where: { roomId: room.id } });
  assert(directNoContext === 0, 'AI_VOLUME_NO_CONTEXT_LEAK');
  const samples = (
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const values: number[] = [];
        for (let i = 0; i < 4; i++) {
          const started = performance.now();
          const rows = await retrieval.retrieve(request);
          assert(
            rows.length > 0 && rows.every((row) => versionIds.includes(row.versionId)),
            'AI_VOLUME_RETRIEVAL_INVALID'
          );
          values.push(Math.round(performance.now() - started));
        }
        return values;
      })
    )
  )
    .flat()
    .sort((a, b) => a - b);
  process.stdout.write(
    `${JSON.stringify({ mode: 'measure', retrievalMode: 'internal-caller-supplied-allowlist', syntheticRoom: ROOM_SLUG, documents: DOCUMENTS, chunks: chunkCount, eligibleChunks: eligible.length, modelId: MODEL_ID, scopedRows: scoped.length, crossTenantRows: crossTenant, directNoContextRows: directNoContext, requests: samples.length, concurrency: 5, p50ClientMs: samples[9], p95ClientMs: samples[18], maxClientMs: samples[19] })}\n`
  );
}

async function main() {
  const mode = process.argv[2] ?? '';
  guard(mode);
  const { organization, other } = await scope();
  if (mode === '--prepare') await prepare(organization.id);
  else await measure(organization.id, other.id);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'AI_VOLUME_QA_FAILED'}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([db.$disconnect(), bootstrapDb.$disconnect()]);
    const exitCode = Number(process.exitCode ?? 0);
    process.stdout.write('', () => process.stderr.write('', () => process.exit(exitCode)));
  });
