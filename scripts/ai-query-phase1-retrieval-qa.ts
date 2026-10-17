/** Read-only, synthetic-only Phase 1 retrieval checks against staging. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { bootstrapDb, db, withOrgContext } from '../src/lib/db';
import { readAiRoomCoverage } from '../src/lib/ai/coverage';
import { AzureEmbeddingProvider } from '../src/lib/ai/embeddingProvider';
import { PostgresRetrievalProvider } from '../src/lib/ai/retrieval';

type Manifest = {
  fixtureSet: string;
  organizations: Array<{ key: string; name: string; slug: string }>;
  rooms: Array<{ key: string; organization: string; name: string; slug: string }>;
  documents: Array<{ key: string; room: string }>;
};

function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}

function assertStagingTarget() {
  const expectedHost = process.env['AI_QA_STAGING_DB_HOST'];
  assert(
    expectedHost?.includes('staging') && expectedHost.endsWith('.postgres.database.azure.com'),
    'AI_QA_STAGING_DB_HOST_REQUIRED'
  );
  assert(
    process.env['AI_QA_SUBSCRIPTION_ID'] === '041a67eb-fec8-41a4-9d70-c35863268cd6',
    'AI_QA_SUBSCRIPTION_INVALID'
  );
  for (const name of ['DATABASE_URL', 'DATABASE_URL_ADMIN']) {
    const value = process.env[name];
    assert(value, `${name}_REQUIRED`);
    const url = new URL(value);
    assert(
      url.hostname === expectedHost && url.pathname === '/vaultspace',
      `${name}_TARGET_INVALID`
    );
  }
  assert(process.env['ENABLE_RLS'] === 'true', 'AI_QA_RLS_REQUIRED');
}

async function main() {
  assertStagingTarget();
  const manifest = JSON.parse(
    await readFile(path.join(process.cwd(), 'qa/ai-query/fixture-manifest.json'), 'utf8')
  ) as Manifest;
  assert(manifest.fixtureSet === 'vaultspace-ai-query-phase0', 'AI_QA_MANIFEST_INVALID');
  const orgs = await bootstrapDb.organization.findMany({
    where: { slug: { in: manifest.organizations.map((item) => item.slug) } },
    select: { id: true, name: true, slug: true },
  });
  assert(orgs.length === 2, 'AI_QA_ORGANIZATIONS_MISSING');
  const orgByKey = new Map(
    manifest.organizations.map((item) => {
      const org = orgs.find(
        (candidate) => candidate.name === item.name && candidate.slug === item.slug
      );
      assert(org, 'AI_QA_ORGANIZATION_MISMATCH');
      return [item.key, org] as const;
    })
  );
  const roomByKey = new Map<string, { id: string; organizationId: string }>();
  const versionByKey = new Map<string, { id: string; documentId: string; roomId: string }>();
  for (const orgSpec of manifest.organizations) {
    const org = orgByKey.get(orgSpec.key)!;
    await withOrgContext(org.id, async (tx) => {
      const rooms = await tx.room.findMany({
        where: { organizationId: org.id, slug: { in: manifest.rooms.map((item) => item.slug) } },
        select: { id: true, name: true, slug: true, status: true, mode: true },
      });
      for (const spec of manifest.rooms.filter((item) => item.organization === orgSpec.key)) {
        const room = rooms.find((item) => item.slug === spec.slug && item.name === spec.name);
        assert(room, 'AI_QA_ROOM_MISMATCH');
        roomByKey.set(spec.key, { id: room.id, organizationId: org.id });
        if (room.status !== 'ACTIVE' || room.mode !== 'INDEPENDENT') continue;
        const documents = await tx.document.findMany({
          where: { organizationId: org.id, roomId: room.id },
          select: { id: true, currentVersionId: true, customMetadata: true },
        });
        for (const document of documents) {
          const key = (document.customMetadata as Record<string, unknown> | null)?.['fixtureKey'];
          assert(
            typeof key === 'string' &&
              manifest.documents.some((item) => item.key === key && item.room === spec.key) &&
              document.currentVersionId,
            'AI_QA_DOCUMENT_MISMATCH'
          );
          versionByKey.set(key, {
            id: document.currentVersionId,
            documentId: document.id,
            roomId: room.id,
          });
        }
      }
    });
  }
  assert(versionByKey.size === manifest.documents.length, 'AI_QA_DOCUMENTS_MISSING');

  const embedder = new AzureEmbeddingProvider();
  const retrieval = new PostgresRetrievalProvider();
  const primary = orgByKey.get('primary')!;
  const isolation = orgByKey.get('isolation')!;
  const other = versionByKey.get('otherTenant')!;
  const full = roomByKey.get('full')!;
  const split = roomByKey.get('split')!;
  const isolationRoom = roomByKey.get('isolation')!;
  const requiredRooms: Array<[string, string]> = [
    [primary.id, full.id],
    [primary.id, split.id],
    [isolation.id, isolationRoom.id],
  ];
  for (const [organizationId, roomId] of requiredRooms) {
    const coverage = await readAiRoomCoverage(organizationId, roomId);
    assert(coverage.ready, 'AI_QA_REQUIRED_ROOM_NOT_READY');
  }
  const fullVersions = ['briefing', 'technology', 'injection'].map(
    (key) => versionByKey.get(key)!.id
  );
  const cases = [
    { id: 'Q001', question: 'What does Cedar Arc Labs build?', expected: 'briefing' },
    { id: 'Q003', question: 'Which other fictional company is mentioned?', expected: 'technology' },
    { id: 'Q018', question: 'battery dispatch optimization', expected: 'technology' },
  ];
  const evidence = [];
  for (const test of cases) {
    const started = performance.now();
    const [vector] = await embedder.embed([test.question]);
    assert(vector, 'AI_QA_EMBEDDING_EMPTY');
    const rows = await retrieval.retrieve({
      organizationId: primary.id,
      roomId: full.id,
      allowedVersionIds: fullVersions,
      question: test.question,
      questionEmbedding: vector,
      embeddingModelId: embedder.modelId,
    });
    const matched = rows.some(
      (row) => row.documentId === versionByKey.get(test.expected)?.documentId
    );
    assert(matched, `AI_QA_RELEVANCE_${test.id}`);
    evidence.push({
      case: test.id,
      matched,
      results: rows.length,
      elapsedMs: Math.round(performance.now() - started),
    });
  }

  const [probeVector] = await embedder.embed(['restricted pricing floor']);
  assert(probeVector, 'AI_QA_EMBEDDING_EMPTY');
  const request = {
    organizationId: primary.id,
    roomId: split.id,
    allowedVersionIds: [versionByKey.get('splitPublic')!.id],
    question: 'What is the restricted pricing floor?',
    questionEmbedding: probeVector,
    embeddingModelId: embedder.modelId,
  };
  const scoped = await retrieval.retrieve(request);
  assert(scoped.length > 0, 'AI_QA_SCOPED_RETRIEVAL_EMPTY');
  const restrictedRows = scoped.filter(
    (row) => row.documentId === versionByKey.get('splitRestricted')!.documentId
  ).length;
  assert(restrictedRows === 0, 'AI_QA_RESTRICTED_SOURCE_LEAK');
  const crossTenant = await retrieval.retrieve({
    ...request,
    roomId: full.id,
    allowedVersionIds: [other.id],
  });
  assert(crossTenant.length === 0, 'AI_QA_CROSS_TENANT_LEAK');
  const wrongModel = await retrieval.retrieve({ ...request, embeddingModelId: 'not-current@0' });
  assert(wrongModel.length === 0, 'AI_QA_STALE_MODEL_LEAK');
  const emptyScope = await retrieval.retrieve({ ...request, allowedVersionIds: [] });
  assert(emptyScope.length === 0, 'AI_QA_EMPTY_SCOPE_LEAK');
  const loadQuestion = 'battery dispatch optimization';
  const [loadVector] = await embedder.embed([loadQuestion]);
  assert(loadVector, 'AI_QA_EMBEDDING_EMPTY');
  const samples = (
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const durations: number[] = [];
        for (let i = 0; i < 4; i++) {
          const started = performance.now();
          const rows = await retrieval.retrieve({
            organizationId: primary.id,
            roomId: full.id,
            allowedVersionIds: fullVersions,
            question: loadQuestion,
            questionEmbedding: loadVector,
            embeddingModelId: embedder.modelId,
          });
          assert(
            rows.some((row) => row.documentId === versionByKey.get('technology')!.documentId),
            'AI_QA_LOAD_RELEVANCE_FAILED'
          );
          durations.push(Math.round(performance.now() - started));
        }
        return durations;
      })
    )
  )
    .flat()
    .sort((a, b) => a - b);
  assert(samples.length === 20, 'AI_QA_LOAD_SAMPLE_COUNT_INVALID');
  const load = { samples: samples.length, concurrency: 5, p95ClientMs: samples[18]! };
  process.stdout.write(
    `${JSON.stringify({ fixtureSet: manifest.fixtureSet, modelId: embedder.modelId, relevance: evidence, scopedRows: scoped.length, restrictedRows, crossTenantRows: crossTenant.length, staleModelRows: wrongModel.length, emptyScopeRows: emptyScope.length, load })}\n`
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'AI_QA_RETRIEVAL_FAILED'}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([db.$disconnect(), bootstrapDb.$disconnect()]);
  });
