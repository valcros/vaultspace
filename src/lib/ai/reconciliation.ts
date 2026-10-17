import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

import { AI_PIPELINE_REVISION } from './chunking';
import { configuredEmbeddingIdentity } from './embeddingProvider';
import { isPermanentAiIndexErrorCode } from './indexErrors';
import { aiIndexInputFingerprint } from './indexFingerprint';
import { isAiMimeSupported } from './sourceEligibility';

export interface AiCoverage {
  organizationId: string;
  roomId: string;
  eligibleDocuments: number;
  indexedDocuments: number;
  missingDocuments: number;
  failedJobs: number;
  oldestPendingAt: Date | null;
}

/** Rechecks every current eligible source and removes derivatives of ineligible versions. */
export async function reconcileAiRoom(
  organizationId: string,
  roomId: string,
  expectedModelId = configuredEmbeddingIdentity(),
  options: { retryPermanentlyFailed?: boolean } = {}
): Promise<AiCoverage> {
  const snapshot = await withOrgContext(
    organizationId,
    async (tx) => {
      const policy = await tx.aiPolicy.findFirst({
        where: { organizationId, roomId, enabled: true },
      });
      const room = await tx.room.findFirst({
        where: { id: roomId, organizationId },
        select: { status: true, mode: true },
      });
      const organization = await tx.organization.findFirst({
        where: { id: organizationId },
        select: { isActive: true, aiEnabled: true },
      });
      const active = Boolean(
        policy &&
        organization?.isActive &&
        organization.aiEnabled &&
        room?.status === 'ACTIVE' &&
        room.mode === 'INDEPENDENT'
      );
      if (active && !expectedModelId) {
        throw new Error('AI_EMBEDDING_NOT_CONFIGURED');
      }
      const docs = active
        ? await tx.document.findMany({
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
              versions: {
                select: {
                  id: true,
                  scanStatus: true,
                  mimeType: true,
                  fileSha256: true,
                  fileBlob: { select: { id: true, storageBucket: true, storageKey: true } },
                },
              },
            },
          })
        : [];
      const eligible = docs.flatMap((doc) => {
        const version = doc.versions.find((candidate) => candidate.id === doc.currentVersionId);
        return version?.scanStatus === 'CLEAN' &&
          version.fileBlob &&
          isAiMimeSupported(version.mimeType)
          ? [
              {
                documentId: doc.id,
                versionId: version.id,
                fingerprint: aiIndexInputFingerprint(
                  {
                    organizationId,
                    roomId,
                    documentId: doc.id,
                    versionId: version.id,
                    fileSha256: version.fileSha256,
                    mimeType: version.mimeType,
                    blobId: version.fileBlob.id,
                    storageBucket: version.fileBlob.storageBucket,
                    storageKey: version.fileBlob.storageKey,
                  },
                  expectedModelId!
                ),
              },
            ]
          : [];
      });
      const eligibleIds = new Set(eligible.map((item) => item.versionId));
      const sources = await tx.aiSource.findMany({
        where: { organizationId, roomId },
        select: {
          id: true,
          versionId: true,
          chunkCount: true,
          state: true,
          embeddingModelId: true,
          pipelineRevision: true,
        },
      });
      for (const source of sources) {
        if (eligibleIds.has(source.versionId)) {
          continue;
        }
        await tx.aiChunk.deleteMany({ where: { organizationId, sourceId: source.id } });
        await tx.aiSource.delete({ where: { id: source.id } });
        await tx.aiIndexAudit.create({
          data: {
            organizationId,
            versionId: source.versionId,
            action: 'RECONCILE',
            outcome: 'PURGED',
            detailCode: 'AI_SOURCE_INELIGIBLE',
          },
        });
      }
      const retained = sources.filter((source) => eligibleIds.has(source.versionId));
      const counts = await Promise.all(
        retained.map((source) =>
          tx.aiChunk.count({ where: { organizationId, sourceId: source.id } })
        )
      );
      const readyIds = new Set(
        retained
          .filter(
            (source, i) =>
              source.state === 'READY' &&
              source.chunkCount > 0 &&
              counts[i] === source.chunkCount &&
              Boolean(expectedModelId) &&
              source.embeddingModelId === expectedModelId &&
              source.pipelineRevision === AI_PIPELINE_REVISION
          )
          .map((source) => source.versionId)
      );
      const missing = eligible.filter((item) => !readyIds.has(item.versionId));
      const priorJobs = await tx.aiIndexJob.findMany({
        where: { organizationId, versionId: { in: missing.map((item) => item.versionId) } },
        select: { versionId: true, state: true, lastErrorCode: true, failureFingerprint: true },
      });
      const permanentlyFailed = new Set(
        priorJobs
          .filter(
            (job) =>
              !options.retryPermanentlyFailed &&
              job.state === 'FAILED' &&
              isPermanentAiIndexErrorCode(job.lastErrorCode) &&
              job.failureFingerprint ===
                missing.find((item) => item.versionId === job.versionId)?.fingerprint
          )
          .map((job) => job.versionId)
      );
      const enqueue = missing.filter((item) => !permanentlyFailed.has(item.versionId));
      for (const item of enqueue) {
        await tx.aiIndexJob.upsert({
          where: { organizationId_versionId: { organizationId, versionId: item.versionId } },
          create: {
            organizationId,
            documentId: item.documentId,
            versionId: item.versionId,
            state: 'PENDING',
          },
          update: {
            state: 'PENDING',
            lastErrorCode: null,
            failureFingerprint: null,
            completedAt: null,
          },
        });
      }
      const failedJobs = await tx.aiIndexJob.count({
        where: { organizationId, state: 'FAILED', versionId: { in: [...eligibleIds] } },
      });
      const oldest = await tx.aiIndexJob.findFirst({
        where: { organizationId, state: 'PENDING', versionId: { in: [...eligibleIds] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      return {
        active,
        eligible,
        readyIds,
        missing,
        enqueue,
        failedJobs,
        oldestPendingAt: oldest?.createdAt ?? null,
      };
    },
    { timeout: 60_000 }
  );

  if (snapshot.active) {
    for (const item of snapshot.enqueue) {
      await getProviders().job.addJob(
        'low',
        'ai.index',
        { organizationId, documentId: item.documentId, versionId: item.versionId },
        {
          jobId: options.retryPermanentlyFailed
            ? `ai-index-retry-${item.versionId}-${Date.now()}`
            : `ai-index-${item.versionId}-${item.fingerprint.slice(0, 16)}`,
          attempts: 4,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
    }
  }
  return {
    organizationId,
    roomId,
    eligibleDocuments: snapshot.eligible.length,
    indexedDocuments: snapshot.readyIds.size,
    missingDocuments: snapshot.missing.length,
    failedJobs: snapshot.failedJobs,
    oldestPendingAt: snapshot.oldestPendingAt,
  };
}
