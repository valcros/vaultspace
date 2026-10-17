import type { Job } from 'bullmq';

import { indexAiVersion } from '@/lib/ai/indexer';

import type { AiIndexJobPayload } from '../types';

export async function processAiIndexJob(job: Job<AiIndexJobPayload>): Promise<void> {
  const { organizationId, documentId, versionId } = job.data;
  if (!organizationId || !documentId || !versionId) {
    throw new Error('AI_INDEX_JOB_INVALID');
  }
  await indexAiVersion(organizationId, documentId, versionId);
}
