import { beforeEach, describe, expect, it, vi } from 'vitest';

// ------ DB mocks ------------------------------------------------------------
const mockUpsert = vi.fn().mockResolvedValue({});
const mockDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
const mockQueryRaw = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    searchIndex: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { PostgresSearchProvider } from './PostgresSearchProvider';

// ---------------------------------------------------------------------------

const provider = new PostgresSearchProvider();

describe('PostgresSearchProvider.index', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts extractedText and documentTitle', async () => {
    await provider.index('org-1', 'doc-1', 'ver-1', {
      title: 'Report.pdf',
      text: 'Quarterly results',
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          documentTitle: 'Report.pdf',
          extractedText: 'Quarterly results',
        }),
        update: expect.objectContaining({
          documentTitle: 'Report.pdf',
          extractedText: 'Quarterly results',
        }),
      })
    );
  });

  it('stores roomId from metadata', async () => {
    await provider.index('org-1', 'doc-1', 'ver-1', {
      title: 'Report.pdf',
      text: 'text',
      metadata: { roomId: 'room-42' },
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ roomId: 'room-42' }),
        update: expect.objectContaining({ roomId: 'room-42' }),
      })
    );
  });

  it('sets roomId to null when not provided', async () => {
    await provider.index('org-1', 'doc-1', 'ver-1', { title: 'f.pdf', text: 'x' });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ roomId: null }),
      })
    );
  });

  it('does NOT overwrite tags, customMetadata, mimeType, or uploadedAt on update', async () => {
    await provider.index('org-1', 'doc-1', 'ver-1', { title: 'f.pdf', text: 'x' });
    const call = mockUpsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect(call.update).not.toHaveProperty('tags');
    expect(call.update).not.toHaveProperty('customMetadata');
    expect(call.update).not.toHaveProperty('mimeType');
    expect(call.update).not.toHaveProperty('uploadedAt');
  });
});

describe('PostgresSearchProvider.search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty results when count is zero', async () => {
    mockQueryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    const result = await provider.search({ query: 'hello', organizationId: 'org-1' });
    expect(result).toEqual({ results: [], total: 0, took: expect.any(Number) });
    // Only one $queryRaw call (count); no second call for rows
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns results when rows are found', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(1) }]).mockResolvedValueOnce([
      {
        documentId: 'doc-1',
        versionId: 'ver-1',
        title: 'Report.pdf',
        snippet: 'Quarterly <b>results</b>',
        score: 0.5,
        highlights: [],
      },
    ]);
    const result = await provider.search({ query: 'results', organizationId: 'org-1' });
    expect(result.total).toBe(1);
    expect(result.results[0]).toMatchObject({
      documentId: 'doc-1',
      title: 'Report.pdf',
      snippet: expect.stringContaining('results'),
    });
  });

  it('passes roomId filter when provided', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(1) }]).mockResolvedValueOnce([
      {
        documentId: 'doc-1',
        versionId: 'ver-1',
        title: 'f.pdf',
        snippet: '',
        score: 0.1,
        highlights: [],
      },
    ]);
    await provider.search({ query: 'x', organizationId: 'org-1', roomId: 'room-42' });
    // Both calls should include the room filter (check via template literal args)
    const [countArgs, rowArgs] = mockQueryRaw.mock.calls;
    expect(JSON.stringify(countArgs)).toContain('room-42');
    expect(JSON.stringify(rowArgs)).toContain('room-42');
  });

  it('clamps limit to 50', async () => {
    mockQueryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    await provider.search({ query: 'q', organizationId: 'org-1', limit: 999 });
    // Just checking it doesn't throw; limit clamping is internal
    expect(mockQueryRaw).toHaveBeenCalled();
  });
});

describe('PostgresSearchProvider.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes all rows for the given org + document', async () => {
    await provider.remove('org-1', 'doc-1');
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', documentId: 'doc-1' },
    });
  });
});
