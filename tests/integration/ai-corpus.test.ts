import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readAiRoomCoverage } from '@/lib/ai/coverage';
import { withOrgContext, db } from '@/lib/db';

import { prisma } from '../../vitest.integration.setup';

async function seed() {
  const suffix = randomUUID();
  const orgA = await prisma.organization.create({
    data: { name: 'AI QA A', slug: `ai-a-${suffix}` },
  });
  const orgB = await prisma.organization.create({
    data: { name: 'AI QA B', slug: `ai-b-${suffix}` },
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
      fileSize: BigInt(12),
    },
  });
  const version = await prisma.documentVersion.create({
    data: {
      organizationId: orgA.id,
      documentId: doc.id,
      versionNumber: 1,
      fileName: 'note.txt',
      mimeType: 'text/plain',
      fileSize: BigInt(12),
      fileSha256: 'a'.repeat(64),
      versionHash: 'b'.repeat(64),
      scanStatus: 'CLEAN',
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
    const complete = await readAiRoomCoverage(orgA.id, roomA.id);
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
    expect(await readAiRoomCoverage(orgA.id, roomA.id)).toMatchObject({
      ready: false,
      cleanCurrentVersions: 0,
      indexedVersions: 0,
    });
    await prisma.document.update({ where: { id: doc.id }, data: { withdrawnAt: new Date() } });
    expect(await readAiRoomCoverage(orgA.id, roomA.id)).toMatchObject({
      activeDocuments: 0,
      ready: false,
    });
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
  });
});
