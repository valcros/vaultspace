import { UnrecoverableError, type Job } from 'bullmq';

import { indexAiVersion } from '@/lib/ai/indexer';

import type { AiIndexJobPayload } from '../types';

const PERMANENT_INDEX_ERRORS = new Set([
  'AI_FORMAT_UNSUPPORTED',
  'AI_FILE_CHECKSUM_MISMATCH',
  'AI_SOURCE_TOO_LARGE',
  'AI_TOO_MANY_CHUNKS',
  'AI_EMPTY_TEXT',
]);

export async function processAiIndexJob(job: Job<AiIndexJobPayload>): Promise<void> {
  const { organizationId, documentId, versionId } = job.data;
  if (!organizationId || !documentId || !versionId) {
    throw new Error('AI_INDEX_JOB_INVALID');
  }
  try {
    await indexAiVersion(organizationId, documentId, versionId);
  } catch (error) {
    if (error instanceof Error && PERMANENT_INDEX_ERRORS.has(error.message)) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}
