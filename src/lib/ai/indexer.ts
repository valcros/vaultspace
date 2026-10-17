import { randomUUID } from 'node:crypto';

import { PDFParse } from 'pdf-parse';
import type { Prisma } from '@prisma/client';

import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

import { AI_PIPELINE_REVISION, chunkPages, sha256, type TextPage } from './chunking';
import { AzureEmbeddingProvider, type EmbeddingProvider } from './embeddingProvider';
import { resolveEligibleSource } from './sourceEligibility';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_CHUNKS = 500;

export type AiIndexOutcome = 'READY' | 'SKIPPED' | 'UNCHANGED';

async function extractPages(bytes: Buffer, mimeType: string): Promise<TextPage[]> {
  if (mimeType === 'text/plain') {
    return [{ pageNumber: null, text: bytes.toString('utf8') }];
  }
  if (mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const result = await parser.getText();
      if (result.pages.some((page) => page.text.trim())) {
        return result.pages.map((page) => ({ pageNumber: page.num, text: page.text }));
      }
    } finally {
      await parser.destroy();
    }
  }
  if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
    const ocr = getProviders().ocr;
    if (!(await ocr.isAvailable())) {
      throw new Error('AI_OCR_UNAVAILABLE');
    }
    const result = await ocr.extractText(bytes, mimeType);
    // The OCR provider returns whole-document text. PDF OCR cannot prove a page
    // anchor, so leave it null rather than inventing one.
    return [{ pageNumber: mimeType.startsWith('image/') ? 1 : null, text: result.text }];
  }
  throw new Error('AI_FORMAT_UNSUPPORTED');
}

async function audit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  documentId: string,
  versionId: string,
  action: string,
  outcome: string,
  detailCode?: string,
  chunkCount?: number
) {
  await tx.aiIndexAudit.create({
    data: { organizationId, documentId, versionId, action, outcome, detailCode, chunkCount },
  });
}

export async function indexAiVersion(
  organizationId: string,
  documentId: string,
  versionId: string,
  embeddingProvider?: EmbeddingProvider
): Promise<AiIndexOutcome> {
  const source = await withOrgContext(organizationId, (tx) =>
    resolveEligibleSource(tx, organizationId, documentId, versionId)
  );
  if (!source) {
    await withOrgContext(organizationId, async (tx) => {
      const existing = await tx.aiSource.findFirst({
        where: { organizationId, versionId },
        select: { id: true },
      });
      if (existing) {
        await tx.aiChunk.deleteMany({ where: { organizationId, sourceId: existing.id } });
        await tx.aiSource.delete({ where: { id: existing.id } });
      }
      await tx.aiIndexJob.updateMany({
        where: { organizationId, versionId },
        data: { state: 'SKIPPED', completedAt: new Date(), lastErrorCode: 'AI_SOURCE_INELIGIBLE' },
      });
      await audit(
        tx,
        organizationId,
        documentId,
        versionId,
        'INDEX',
        'SKIPPED',
        'AI_SOURCE_INELIGIBLE'
      );
    });
    return 'SKIPPED';
  }

  const expectedModelId = embeddingProvider?.modelId ?? process.env['AI_EMBEDDING_DEPLOYMENT'];
  if (!expectedModelId) {
    throw new Error('AI_EMBEDDING_NOT_CONFIGURED');
  }
  const existing = await withOrgContext(organizationId, (tx) =>
    tx.aiSource.findFirst({
      where: {
        organizationId,
        versionId,
        state: 'READY',
        fileSha256: source.fileSha256,
        embeddingModelId: expectedModelId,
        pipelineRevision: AI_PIPELINE_REVISION,
      },
      select: { id: true, chunkCount: true, contentSha256: true },
    })
  );
  if (existing && existing.chunkCount > 0) {
    const count = await withOrgContext(organizationId, (tx) =>
      tx.aiChunk.count({ where: { organizationId, sourceId: existing.id } })
    );
    if (count === existing.chunkCount) {
      return 'UNCHANGED';
    }
  }

  await withOrgContext(organizationId, async (tx) => {
    await tx.aiIndexJob.upsert({
      where: { organizationId_versionId: { organizationId, versionId } },
      create: { organizationId, documentId, versionId, state: 'RUNNING', attempts: 1 },
      update: {
        state: 'RUNNING',
        attempts: { increment: 1 },
        lastErrorCode: null,
        completedAt: null,
      },
    });
  });

  try {
    const bytes = await getProviders().storage.get(source.storageBucket, source.storageKey);
    if (bytes.length > MAX_SOURCE_BYTES) {
      throw new Error('AI_SOURCE_TOO_LARGE');
    }
    if (sha256(bytes) !== source.fileSha256) {
      throw new Error('AI_FILE_CHECKSUM_MISMATCH');
    }
    const pages = await extractPages(bytes, source.mimeType);
    const chunks = chunkPages(pages);
    if (!chunks.length) {
      throw new Error('AI_EMPTY_TEXT');
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new Error('AI_TOO_MANY_CHUNKS');
    }
    const contentSha256 = sha256(chunks.map((chunk) => chunk.contentSha256).join(':'));
    const embedder = embeddingProvider ?? new AzureEmbeddingProvider();
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += 16) {
      embeddings.push(
        ...(await embedder.embed(chunks.slice(i, i + 16).map((chunk) => chunk.text)))
      );
    }
    if (
      embedder.dimensions !== 1536 ||
      embeddings.length !== chunks.length ||
      embeddings.some((vector) => vector.length !== 1536 || vector.some((n) => !Number.isFinite(n)))
    ) {
      throw new Error('AI_EMBEDDING_DIMENSIONS_INVALID');
    }

    return await withOrgContext(
      organizationId,
      async (tx) => {
        // Serialize duplicate jobs and version changes against the document row.
        await tx.$queryRaw`SELECT id FROM documents WHERE id = ${documentId} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const current = await resolveEligibleSource(tx, organizationId, documentId, versionId);
        if (
          !current ||
          current.fileSha256 !== source.fileSha256 ||
          current.storageKey !== source.storageKey
        ) {
          const stale = await tx.aiSource.findFirst({
            where: { organizationId, versionId },
            select: { id: true },
          });
          if (stale) {
            await tx.aiChunk.deleteMany({ where: { organizationId, sourceId: stale.id } });
            await tx.aiSource.delete({ where: { id: stale.id } });
          }
          await tx.aiIndexJob.updateMany({
            where: { organizationId, versionId },
            data: { state: 'SKIPPED', completedAt: new Date(), lastErrorCode: 'AI_SOURCE_CHANGED' },
          });
          await audit(
            tx,
            organizationId,
            documentId,
            versionId,
            'INDEX',
            'SKIPPED',
            'AI_SOURCE_CHANGED'
          );
          return 'SKIPPED';
        }
        const prior = await tx.aiSource.findFirst({
          where: { organizationId, versionId },
          select: { id: true },
        });
        const sourceId = prior?.id ?? randomUUID();
        if (prior) {
          await tx.aiChunk.deleteMany({ where: { organizationId, sourceId } });
        }
        await tx.aiSource.upsert({
          where: { versionId },
          create: {
            id: sourceId,
            organizationId,
            roomId: source.roomId,
            documentId,
            versionId,
            fileSha256: source.fileSha256,
            contentSha256,
            embeddingModelId: embedder.modelId,
            pipelineRevision: AI_PIPELINE_REVISION,
            chunkCount: chunks.length,
            indexedAt: new Date(),
          },
          update: {
            roomId: source.roomId,
            documentId,
            fileSha256: source.fileSha256,
            contentSha256,
            embeddingModelId: embedder.modelId,
            pipelineRevision: AI_PIPELINE_REVISION,
            chunkCount: chunks.length,
            state: 'READY',
            indexedAt: new Date(),
          },
        });
        await tx.aiChunk.createMany({
          data: chunks.map((chunk, index) => ({
            id: randomUUID(),
            organizationId,
            roomId: source.roomId,
            sourceId,
            documentId,
            versionId,
            ordinal: chunk.ordinal,
            pageNumber: chunk.pageNumber,
            content: chunk.text,
            contentSha256: chunk.contentSha256,
            embedding: embeddings[index]!,
          })),
        });
        await tx.aiIndexJob.updateMany({
          where: { organizationId, versionId },
          data: { state: 'READY', completedAt: new Date(), lastErrorCode: null },
        });
        await audit(
          tx,
          organizationId,
          documentId,
          versionId,
          'INDEX',
          'READY',
          undefined,
          chunks.length
        );
        return 'READY';
      },
      { timeout: 60_000 }
    );
  } catch (error) {
    const code =
      error instanceof Error && /^AI_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'AI_INDEX_FAILED';
    await withOrgContext(organizationId, async (tx) => {
      await tx.aiIndexJob.updateMany({
        where: { organizationId, versionId },
        data: { state: 'FAILED', lastErrorCode: code },
      });
      await audit(tx, organizationId, documentId, versionId, 'INDEX', 'FAILED', code);
    });
    // BullMQ may retain failure messages. Keep them categorical and content-free.
    throw new Error(code);
  }
}
