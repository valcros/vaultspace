import { UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIndexAiVersion = vi.fn();
vi.mock('@/lib/ai/indexer', () => ({
  indexAiVersion: (...args: unknown[]) => mockIndexAiVersion(...args),
}));

import { processAiIndexJob } from './aiIndexProcessor';

const job = {
  data: { organizationId: 'org-a', documentId: 'doc-a', versionId: 'version-a' },
} as never;

beforeEach(() => {
  mockIndexAiVersion.mockReset();
});

describe('AI index retry boundary', () => {
  it('marks deterministic source failures as unrecoverable', async () => {
    mockIndexAiVersion.mockRejectedValue(new Error('AI_FILE_CHECKSUM_MISMATCH'));
    await expect(processAiIndexJob(job)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('preserves transient provider errors for retry', async () => {
    mockIndexAiVersion.mockRejectedValue(new Error('AI_EMBEDDING_HTTP_429'));
    await expect(processAiIndexJob(job)).rejects.toThrow('AI_EMBEDDING_HTTP_429');
    await expect(processAiIndexJob(job)).rejects.not.toBeInstanceOf(UnrecoverableError);
  });
});
