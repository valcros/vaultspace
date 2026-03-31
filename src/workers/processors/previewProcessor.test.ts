/**
 * Preview Processor Tests
 *
 * Tests inline thumbnail generation, file size guard, and upsert behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock db
const mockVersionUpdate = vi.fn().mockResolvedValue({});
const mockDocumentUpdate = vi.fn().mockResolvedValue({});
const mockPreviewAssetCreate = vi.fn().mockResolvedValue({ id: 'asset-1' });
const mockPreviewAssetUpsert = vi.fn().mockResolvedValue({ id: 'thumb-1' });
const mockDocumentFindFirst = vi.fn().mockResolvedValue({ roomId: 'room-1' });

vi.mock('@/lib/db', () => ({
  db: {
    documentVersion: { update: (...args: unknown[]) => mockVersionUpdate(...args) },
    document: {
      update: (...args: unknown[]) => mockDocumentUpdate(...args),
      findFirst: (...args: unknown[]) => mockDocumentFindFirst(...args),
    },
    previewAsset: {
      create: (...args: unknown[]) => mockPreviewAssetCreate(...args),
      upsert: (...args: unknown[]) => mockPreviewAssetUpsert(...args),
    },
  },
}));

// Mock providers
const mockStorageGet = vi.fn().mockResolvedValue(Buffer.from('file-content'));
const mockStoragePut = vi.fn().mockResolvedValue(undefined);
const mockJobAddJob = vi.fn().mockResolvedValue('job-1');
const mockConvert = vi.fn().mockResolvedValue({
  pages: [
    {
      pageNumber: 1,
      data: Buffer.from('page-1-png'),
      width: 800,
      height: 1100,
      mimeType: 'image/png',
    },
  ],
  totalPages: 1,
  mimeType: 'image/png',
});
const mockIsSupported = vi.fn().mockReturnValue(true);
const mockGenerateThumbnailPng = vi.fn().mockResolvedValue(Buffer.from('thumbnail-png'));

vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: {
      get: mockStorageGet,
      put: mockStoragePut,
    },
    job: {
      addJob: mockJobAddJob,
    },
    preview: {
      convert: mockConvert,
      isSupported: mockIsSupported,
      generateThumbnailPng: mockGenerateThumbnailPng,
      generateThumbnail: vi.fn().mockResolvedValue(Buffer.from('thumb')),
    },
  }),
}));

import { processPreviewJob, processThumbnailJob } from './previewProcessor';

function createMockJob(overrides = {}) {
  return {
    data: {
      documentId: 'doc-1',
      versionId: 'ver-1',
      organizationId: 'org-1',
      storageKey: 'documents/org-1/file.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'report.docx',
      fileSizeBytes: 1024,
      isScanned: false,
      ...overrides,
    },
    id: 'job-1',
    name: 'preview.generate',
  } as never;
}

describe('processPreviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('file-content'));
    mockGenerateThumbnailPng.mockResolvedValue(Buffer.from('thumbnail-png'));
  });

  it('generates thumbnail from original file bytes, not preview output', async () => {
    const fileContent = Buffer.from('original-file-bytes');
    mockStorageGet.mockResolvedValue(fileContent);

    await processPreviewJob(createMockJob());

    // generateThumbnailPng should receive the original file buffer
    expect(mockGenerateThumbnailPng).toHaveBeenCalledWith(
      fileContent,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'report.docx',
      200,
      280
    );
  });

  it('uses upsert for thumbnail storage (idempotent)', async () => {
    await processPreviewJob(createMockJob());

    expect(mockPreviewAssetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          versionId_assetType_pageNumber: {
            versionId: 'ver-1',
            assetType: 'THUMBNAIL',
            pageNumber: 1,
          },
        },
        create: expect.objectContaining({
          assetType: 'THUMBNAIL',
          versionId: 'ver-1',
          mimeType: 'image/png',
        }),
        update: expect.objectContaining({
          mimeType: 'image/png',
        }),
      })
    );
  });

  it('skips proactive thumbnail for files > 25MB', async () => {
    const largeBuffer = Buffer.alloc(26 * 1024 * 1024); // 26MB
    mockStorageGet.mockResolvedValue(largeBuffer);

    await processPreviewJob(createMockJob());

    expect(mockGenerateThumbnailPng).not.toHaveBeenCalled();
    expect(mockPreviewAssetUpsert).not.toHaveBeenCalled();
  });

  it('generates thumbnail for files <= 25MB', async () => {
    const smallBuffer = Buffer.alloc(24 * 1024 * 1024); // 24MB
    mockStorageGet.mockResolvedValue(smallBuffer);

    await processPreviewJob(createMockJob());

    expect(mockGenerateThumbnailPng).toHaveBeenCalled();
  });

  it('thumbnail failure does not fail the preview job', async () => {
    mockGenerateThumbnailPng.mockRejectedValue(new Error('thumbnail failed'));

    // Should not throw
    await processPreviewJob(createMockJob());

    // Preview should still be marked as READY
    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ previewStatus: 'READY' }),
      })
    );
  });

  it('does not create duplicate rows on retry (upsert)', async () => {
    await processPreviewJob(createMockJob());
    await processPreviewJob(createMockJob());

    // Each call uses upsert, not create — so even if called twice,
    // only one row exists (the unique constraint handles this)
    const upsertCalls = mockPreviewAssetUpsert.mock.calls;
    for (const call of upsertCalls) {
      expect(call[0].where).toEqual({
        versionId_assetType_pageNumber: {
          versionId: 'ver-1',
          assetType: 'THUMBNAIL',
          pageNumber: 1,
        },
      });
    }
  });

  it('queues text extraction after preview generation', async () => {
    await processPreviewJob(createMockJob());

    expect(mockJobAddJob).toHaveBeenCalledWith(
      'high',
      'text.extract',
      expect.objectContaining({
        documentId: 'doc-1',
        versionId: 'ver-1',
      }),
      expect.any(Object)
    );
  });
});

describe('processThumbnailJob (deprecated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('preview-image-data'));
  });

  it('still works for backward compatibility', async () => {
    const job = {
      data: {
        documentId: 'doc-1',
        versionId: 'ver-1',
        organizationId: 'org-1',
        previewKey: 'previews/doc-1/ver-1/page-1.png',
        pageNumber: 1,
        width: 200,
        height: 280,
      },
    } as never;

    await processThumbnailJob(job);

    expect(mockPreviewAssetUpsert).toHaveBeenCalled();
    expect(mockStoragePut).toHaveBeenCalledWith(
      'previews',
      'thumbnails/doc-1/ver-1.png',
      expect.any(Buffer)
    );
  });

  it('uses upsert for idempotency', async () => {
    const job = {
      data: {
        documentId: 'doc-1',
        versionId: 'ver-1',
        organizationId: 'org-1',
        previewKey: 'previews/doc-1/ver-1/page-1.png',
        pageNumber: 1,
        width: 200,
        height: 280,
      },
    } as never;

    await processThumbnailJob(job);

    expect(mockPreviewAssetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          versionId_assetType_pageNumber: {
            versionId: 'ver-1',
            assetType: 'THUMBNAIL',
            pageNumber: 1,
          },
        },
      })
    );
  });
});
