import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveEligibleSource = vi.fn();
const mockStorageGet = vi.fn();
const tx = {
  aiSource: { findFirst: vi.fn(), delete: vi.fn(), upsert: vi.fn() },
  aiChunk: { count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  aiIndexJob: { upsert: vi.fn(), updateMany: vi.fn() },
  aiIndexAudit: { create: vi.fn() },
  $queryRaw: vi.fn(),
};

vi.mock('@/lib/db', () => ({
  withOrgContext: async (_org: string, operation: (db: typeof tx) => Promise<unknown>) =>
    operation(tx),
}));
vi.mock('@/providers', () => ({ getProviders: () => ({ storage: { get: mockStorageGet } }) }));
vi.mock('./sourceEligibility', () => ({
  resolveEligibleSource: (...args: unknown[]) => mockResolveEligibleSource(...args),
}));

import { indexAiVersion } from './indexer';

const bytes = Buffer.from('Synthetic source text');
const source = {
  organizationId: 'org-a',
  roomId: 'room-a',
  documentId: 'doc-a',
  versionId: 'version-a',
  fileSha256: createHash('sha256').update(bytes).digest('hex'),
  mimeType: 'text/plain',
  storageBucket: 'documents',
  storageKey: 'org-a/source.txt',
};
const provider = {
  dimensions: 1536,
  modelId: 'synthetic-embed-v1',
  embed: vi.fn().mockResolvedValue([[1, ...Array(1535).fill(0)]]),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveEligibleSource.mockResolvedValue(source);
  mockStorageGet.mockResolvedValue(bytes);
  tx.aiSource.findFirst.mockResolvedValue(null);
  tx.aiIndexJob.upsert.mockResolvedValue({});
  tx.aiIndexJob.updateMany.mockResolvedValue({ count: 1 });
  tx.aiIndexAudit.create.mockResolvedValue({});
  tx.aiChunk.createMany.mockResolvedValue({ count: 1 });
  tx.$queryRaw.mockResolvedValue([{ id: 'doc-a' }]);
});

describe('AI index worker trust boundary', () => {
  it('never reads storage or calls a model for an ineligible source', async () => {
    mockResolveEligibleSource.mockResolvedValue(null);
    expect(await indexAiVersion('org-a', 'doc-a', 'version-a', provider)).toBe('SKIPPED');
    expect(mockStorageGet).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('refuses a checksum mismatch before embedding and records a categorical failure', async () => {
    mockStorageGet.mockResolvedValue(Buffer.from('tampered bytes'));
    await expect(indexAiVersion('org-a', 'doc-a', 'version-a', provider)).rejects.toThrow(
      'AI_FILE_CHECKSUM_MISMATCH'
    );
    expect(provider.embed).not.toHaveBeenCalled();
    expect(tx.aiIndexJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'FAILED',
          lastErrorCode: 'AI_FILE_CHECKSUM_MISMATCH',
        }),
      })
    );
    expect(tx.aiIndexAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: 'FAILED',
          detailCode: 'AI_FILE_CHECKSUM_MISMATCH',
        }),
      })
    );
  });

  it('drops an obsolete version after embedding and before committing chunks', async () => {
    mockResolveEligibleSource.mockResolvedValueOnce(source).mockResolvedValueOnce(null);
    expect(await indexAiVersion('org-a', 'doc-a', 'version-a', provider)).toBe('SKIPPED');
    expect(provider.embed).toHaveBeenCalledOnce();
    expect(tx.aiChunk.createMany).not.toHaveBeenCalled();
    expect(tx.aiIndexAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'SKIPPED', detailCode: 'AI_SOURCE_CHANGED' }),
      })
    );
  });
});
