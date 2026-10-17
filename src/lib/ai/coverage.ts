import { withOrgContext } from '@/lib/db';

import { AI_PIPELINE_REVISION } from './chunking';
import { configuredEmbeddingIdentity } from './embeddingProvider';

export interface AiRoomCoverage {
  roomId: string;
  organizationEnabled: boolean;
  enabled: boolean;
  activeDocuments: number;
  cleanCurrentVersions: number;
  indexedVersions: number;
  missingVersions: number;
  failedJobs: number;
  oldestPendingAt: Date | null;
  ready: boolean;
}

/** Metadata only. It never reads chunks, embeddings, or document text. */
export async function readAiRoomCoverage(
  organizationId: string,
  roomId: string,
  expectedModelId = configuredEmbeddingIdentity()
): Promise<AiRoomCoverage> {
  return withOrgContext(organizationId, async (tx) => {
    const room = await tx.room.findFirst({
      where: { id: roomId, organizationId },
      select: { id: true, status: true, mode: true },
    });
    if (!room) {
      throw new Error('AI_ROOM_NOT_FOUND');
    }
    const organization = await tx.organization.findFirst({
      where: { id: organizationId },
      select: { isActive: true, aiEnabled: true },
    });
    const policy = await tx.aiPolicy.findFirst({
      where: { organizationId, roomId },
      select: { enabled: true },
    });
    const docs = await tx.document.findMany({
      where: {
        organizationId,
        roomId,
        status: 'ACTIVE',
        deletedAt: null,
        withdrawnAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        currentVersionId: true,
        versions: { select: { id: true, scanStatus: true, fileSha256: true } },
      },
    });
    const cleanVersions = docs.flatMap((doc) => {
      const version = doc.versions.find((item) => item.id === doc.currentVersionId);
      return version?.scanStatus === 'CLEAN' ? [version] : [];
    });
    const clean = cleanVersions.map((version) => version.id);
    const checksumByVersion = new Map(
      cleanVersions.map((version) => [version.id, version.fileSha256])
    );
    const sources = await tx.aiSource.findMany({
      where: { organizationId, roomId, versionId: { in: clean }, state: 'READY' },
      select: {
        id: true,
        versionId: true,
        fileSha256: true,
        chunkCount: true,
        embeddingModelId: true,
        pipelineRevision: true,
      },
    });
    const chunkCounts = await Promise.all(
      sources.map((source) => tx.aiChunk.count({ where: { organizationId, sourceId: source.id } }))
    );
    const indexed = new Set(
      sources
        .filter(
          (source, i) =>
            source.chunkCount > 0 &&
            Boolean(expectedModelId) &&
            source.embeddingModelId === expectedModelId &&
            source.pipelineRevision === AI_PIPELINE_REVISION &&
            source.fileSha256 === checksumByVersion.get(source.versionId) &&
            source.chunkCount === chunkCounts[i]
        )
        .map((source) => source.versionId)
    );
    const failedJobs = await tx.aiIndexJob.count({
      where: { organizationId, state: 'FAILED', documentId: { in: docs.map((doc) => doc.id) } },
    });
    const pending = await tx.aiIndexJob.findFirst({
      where: { organizationId, state: 'PENDING', documentId: { in: docs.map((doc) => doc.id) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const enabled = Boolean(policy?.enabled);
    return {
      roomId,
      organizationEnabled: Boolean(organization?.aiEnabled),
      enabled,
      activeDocuments: docs.length,
      cleanCurrentVersions: clean.length,
      indexedVersions: indexed.size,
      missingVersions: docs.length - indexed.size,
      failedJobs,
      oldestPendingAt: pending?.createdAt ?? null,
      ready:
        enabled &&
        Boolean(organization?.isActive) &&
        Boolean(organization?.aiEnabled) &&
        room.status === 'ACTIVE' &&
        room.mode === 'INDEPENDENT' &&
        docs.length > 0 &&
        indexed.size === docs.length &&
        failedJobs === 0,
    };
  });
}
