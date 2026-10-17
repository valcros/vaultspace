import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';

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
export async function reconcileAiRoom(organizationId: string, roomId: string): Promise<AiCoverage> {
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
      const active = Boolean(policy && room?.status === 'ACTIVE' && room.mode === 'INDEPENDENT');
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
              versions: { select: { id: true, scanStatus: true } },
            },
          })
        : [];
      const eligible = docs.flatMap((doc) => {
        const version = doc.versions.find((candidate) => candidate.id === doc.currentVersionId);
        return version?.scanStatus === 'CLEAN'
          ? [{ documentId: doc.id, versionId: version.id }]
          : [];
      });
      const eligibleIds = new Set(eligible.map((item) => item.versionId));
      const sources = await tx.aiSource.findMany({
        where: { organizationId, roomId },
        select: { id: true, versionId: true, chunkCount: true, state: true },
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
              source.state === 'READY' && source.chunkCount > 0 && counts[i] === source.chunkCount
          )
          .map((source) => source.versionId)
      );
      const missing = eligible.filter((item) => !readyIds.has(item.versionId));
      for (const item of missing) {
        await tx.aiIndexJob.upsert({
          where: { organizationId_versionId: { organizationId, versionId: item.versionId } },
          create: { organizationId, ...item, state: 'PENDING' },
          update: { state: 'PENDING', lastErrorCode: null, completedAt: null },
        });
      }
      const failedJobs = await tx.aiIndexJob.count({
        where: { organizationId, state: 'FAILED', documentId: { in: docs.map((doc) => doc.id) } },
      });
      const oldest = await tx.aiIndexJob.findFirst({
        where: { organizationId, state: 'PENDING', documentId: { in: docs.map((doc) => doc.id) } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      return {
        active,
        eligible,
        readyIds,
        missing,
        failedJobs,
        oldestPendingAt: oldest?.createdAt ?? null,
      };
    },
    { timeout: 60_000 }
  );

  if (snapshot.active) {
    for (const item of snapshot.missing) {
      await getProviders().job.addJob(
        'low',
        'ai.index',
        { organizationId, ...item },
        {
          jobId: `ai-index-${item.versionId}`,
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
