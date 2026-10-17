import { UnrecoverableError, type Job } from 'bullmq';

import { isPermanentAiIndexErrorCode } from '@/lib/ai/indexErrors';
import { indexAiVersion } from '@/lib/ai/indexer';

import type { AiIndexJobPayload } from '../types';

export async function processAiIndexJob(job: Job<AiIndexJobPayload>): Promise<void> {
  const { organizationId, documentId, versionId } = job.data;
  if (!organizationId || !documentId || !versionId) {
    throw new Error('AI_INDEX_JOB_INVALID');
  }
  try {
    await indexAiVersion(organizationId, documentId, versionId);
  } catch (error) {
    if (error instanceof Error && isPermanentAiIndexErrorCode(error.message)) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}
