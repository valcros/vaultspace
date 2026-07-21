import { beforeEach, describe, expect, it, vi } from 'vitest';

// ------ pdf-parse mock ------------------------------------------------------
const mockPdfGetText = vi.fn();
vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(() => ({ getText: mockPdfGetText })),
}));

// ------ DB mocks ------------------------------------------------------------
const mockExtractedTextUpsert = vi.fn().mockResolvedValue({});
const mockDocumentFindFirst = vi.fn();
const mockDocumentVersionFindUnique = vi.fn();
// Worker-side scan gate reads the version's scan status before extracting;
// default to a servable (CLEAN) version so existing tests still index text.
const mockDocumentVersionFindFirst = vi.fn().mockResolvedValue({ scanStatus: 'CLEAN' });
const mockSearchIndexUpsert = vi.fn().mockResolvedValue({});

vi.mock('@/lib/db', () => {
  const mockDb = {
    extractedText: { upsert: (...args: unknown[]) => mockExtractedTextUpsert(...args) },
    document: { findFirst: (...args: unknown[]) => mockDocumentFindFirst(...args) },
    documentVersion: {
      findUnique: (...args: unknown[]) => mockDocumentVersionFindUnique(...args),
      findFirst: (...args: unknown[]) => mockDocumentVersionFindFirst(...args),
    },
    searchIndex: { upsert: (...args: unknown[]) => mockSearchIndexUpsert(...args) },
  };

  return {
    db: mockDb,
    withOrgContext: async (
      _organizationId: string,
      operation: (tx: typeof mockDb) => Promise<unknown>
    ) => operation(mockDb),
  };
});

// ------ Provider mocks -------------------------------------------------------
const mockStorageGet = vi.fn().mockResolvedValue(Buffer.from('file-bytes'));
const mockJobAddJob = vi.fn().mockResolvedValue('job-1');
const mockOcrExtractText = vi.fn();
const mockOcrIsAvailable = vi.fn().mockResolvedValue(false);
const mockSearchIndex = vi.fn().mockResolvedValue(undefined);

vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: { get: mockStorageGet },
    job: { addJob: mockJobAddJob },
    ocr: { extractText: mockOcrExtractText, isAvailable: mockOcrIsAvailable },
    search: { index: mockSearchIndex },
  }),
}));

import { processSearchIndexJob, processTextExtractJob } from './textProcessor';

// ---------------------------------------------------------------------------

function makeExtractJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      documentId: 'doc-1',
      versionId: 'ver-1',
      organizationId: 'org-1',
      storageKey: 'documents/org-1/file.pdf',
      contentType: 'application/pdf',
      fileName: 'report.pdf',
      ...overrides,
    },
    id: 'job-1',
    name: 'text.extract',
  } as never;
}

function makeIndexJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      documentId: 'doc-1',
      versionId: 'ver-1',
      organizationId: 'org-1',
      roomId: 'room-1',
      fileName: 'report.pdf',
      text: 'Hello world',
      metadata: { pageCount: 2 },
      ...overrides,
    },
    id: 'job-2',
    name: 'search.index',
  } as never;
}

// ---------------------------------------------------------------------------

// Reset the scan-gate lookup to a servable default before EVERY test so the
// per-describe `vi.clearAllMocks()` (which preserves implementations) can't let
// a non-servable status set by one test leak into the next.
beforeEach(() => {
  mockDocumentVersionFindFirst.mockResolvedValue({ scanStatus: 'CLEAN' });
});

// Worker-side scan gate: never extract/index a non-servable original -- indexed
// text surfaces as search snippets. Queue payloads are not authorization.
describe('processTextExtractJob — scan gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('plain text content'));
    mockDocumentVersionFindFirst.mockResolvedValue({ scanStatus: 'CLEAN' });
  });

  it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
    'skips extraction when the version is %s (not servable)',
    async (scanStatus) => {
      mockDocumentVersionFindFirst.mockResolvedValue({ scanStatus });

      await processTextExtractJob(makeExtractJob());

      // No bytes read, no text indexed, no downstream search job.
      expect(mockStorageGet).not.toHaveBeenCalled();
      expect(mockExtractedTextUpsert).not.toHaveBeenCalled();
      expect(mockJobAddJob).not.toHaveBeenCalled();
    }
  );

  it('skips extraction when the version no longer exists', async () => {
    mockDocumentVersionFindFirst.mockResolvedValue(null);

    await processTextExtractJob(makeExtractJob());

    expect(mockStorageGet).not.toHaveBeenCalled();
  });

  it('proceeds for a SKIPPED (allowed-but-unscanned) version', async () => {
    mockDocumentVersionFindFirst.mockResolvedValue({ scanStatus: 'SKIPPED' });
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1', name: 'report.txt' });

    await processTextExtractJob(makeExtractJob({ contentType: 'text/plain' }));

    expect(mockStorageGet).toHaveBeenCalled();
  });
});

describe('processTextExtractJob — plain text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('plain text content'));
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1', name: 'report.txt' });
    mockJobAddJob.mockResolvedValue('job-1');
  });

  it('extracts text directly from the buffer', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'text/plain' }));
    expect(mockExtractedTextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ plainText: 'plain text content' }),
      })
    );
  });

  it('queues a search.index job after extraction', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'text/plain' }));
    expect(mockJobAddJob).toHaveBeenCalledWith(
      'normal',
      'search.index',
      expect.objectContaining({ documentId: 'doc-1', versionId: 'ver-1', roomId: 'room-1' })
    );
  });
});

describe('processTextExtractJob — PDF with extractable text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('pdf-bytes'));
    mockPdfGetText.mockResolvedValue({ text: 'Extracted PDF text' });
    mockOcrIsAvailable.mockResolvedValue(false);
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1', name: 'report.pdf' });
    mockJobAddJob.mockResolvedValue('job-1');
  });

  it('extracts text via pdf-parse', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'application/pdf' }));
    expect(mockExtractedTextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ plainText: 'Extracted PDF text' }),
      })
    );
  });

  it('does not call OCR when PDF text is present', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'application/pdf' }));
    expect(mockOcrExtractText).not.toHaveBeenCalled();
  });
});

describe('processTextExtractJob — image-based PDF falls back to OCR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('pdf-bytes'));
    mockPdfGetText.mockResolvedValue({ text: '   ' }); // whitespace-only → image-based
    mockOcrIsAvailable.mockResolvedValue(true);
    mockOcrExtractText.mockResolvedValue({ text: 'OCR result', language: 'en', confidence: 90 });
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1', name: 'scan.pdf' });
    mockJobAddJob.mockResolvedValue('job-1');
  });

  it('attempts OCR when pdf-parse returns empty text', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'application/pdf' }));
    expect(mockOcrExtractText).toHaveBeenCalled();
  });

  it('stores the OCR result', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'application/pdf' }));
    expect(mockExtractedTextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ plainText: 'OCR result' }),
      })
    );
  });
});

describe('processTextExtractJob — PDF parse failure fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('corrupt-pdf'));
    mockPdfGetText.mockRejectedValue(new Error('Invalid PDF structure'));
    mockOcrIsAvailable.mockResolvedValue(true);
    mockOcrExtractText.mockResolvedValue({
      text: 'OCR fallback text',
      language: 'en',
      confidence: 85,
    });
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1', name: 'scan.pdf' });
    mockJobAddJob.mockResolvedValue('job-1');
  });

  it('falls back to OCR when PDF parse throws', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'application/pdf' }));
    expect(mockOcrExtractText).toHaveBeenCalled();
    expect(mockExtractedTextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ plainText: 'OCR fallback text' }),
      })
    );
  });

  it('stores empty string when pdf parse fails and OCR is unavailable', async () => {
    mockOcrIsAvailable.mockResolvedValue(false);
    await processTextExtractJob(makeExtractJob({ contentType: 'application/pdf' }));
    expect(mockExtractedTextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ plainText: '' }),
      })
    );
  });
});

describe('processTextExtractJob — image via OCR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('image-bytes'));
    mockOcrIsAvailable.mockResolvedValue(true);
    mockOcrExtractText.mockResolvedValue({ text: 'Image text', language: 'en', confidence: 95 });
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1', name: 'photo.jpg' });
    mockJobAddJob.mockResolvedValue('job-1');
  });

  it('calls OCR for image content types', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'image/jpeg' }));
    expect(mockOcrExtractText).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg');
  });

  it('stores the OCR text', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'image/jpeg' }));
    expect(mockExtractedTextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ plainText: 'Image text' }),
      })
    );
  });

  it('stores empty string when OCR is unavailable for image', async () => {
    mockOcrIsAvailable.mockResolvedValue(false);
    await processTextExtractJob(makeExtractJob({ contentType: 'image/png' }));
    expect(mockExtractedTextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ plainText: '' }),
      })
    );
  });
});

describe('processTextExtractJob — unsupported content type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('binary'));
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1', name: 'data.bin' });
    mockJobAddJob.mockResolvedValue('job-1');
  });

  it('stores empty string for unsupported content types', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'application/octet-stream' }));
    expect(mockExtractedTextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ plainText: '' }),
      })
    );
  });
});

describe('processTextExtractJob — no search job when document missing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue(Buffer.from('plain text'));
    mockDocumentFindFirst.mockResolvedValue(null);
  });

  it('does not queue a search.index job when document is not found', async () => {
    await processTextExtractJob(makeExtractJob({ contentType: 'text/plain' }));
    expect(mockJobAddJob).not.toHaveBeenCalled();
  });
});

describe('processTextExtractJob — extraction error does not throw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockRejectedValue(new Error('Storage unavailable'));
  });

  it('does not re-throw errors to avoid blocking document processing', async () => {
    await expect(processTextExtractJob(makeExtractJob())).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('processSearchIndexJob — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocumentVersionFindUnique.mockResolvedValue({
      mimeType: 'application/pdf',
      createdAt: new Date('2024-01-01'),
    });
    mockDocumentFindFirst.mockResolvedValue({ tags: ['finance'], customMetadata: { year: 2024 } });
    mockSearchIndexUpsert.mockResolvedValue({});
    mockSearchIndex.mockResolvedValue(undefined);
  });

  it('upserts the search index record', async () => {
    await processSearchIndexJob(makeIndexJob());
    expect(mockSearchIndexUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_versionId: { organizationId: 'org-1', versionId: 'ver-1' } },
        create: expect.objectContaining({
          organizationId: 'org-1',
          documentId: 'doc-1',
          versionId: 'ver-1',
          extractedText: 'Hello world',
        }),
      })
    );
  });

  it('calls the external search provider', async () => {
    await processSearchIndexJob(makeIndexJob());
    expect(mockSearchIndex).toHaveBeenCalledWith(
      'org-1',
      'doc-1',
      'ver-1',
      expect.objectContaining({ title: 'report.pdf', text: 'Hello world' })
    );
  });

  it('includes roomId in the metadata passed to the search provider', async () => {
    await processSearchIndexJob(makeIndexJob());
    expect(mockSearchIndex).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ roomId: 'room-1' }),
      })
    );
  });
});

describe('processSearchIndexJob — error does not throw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocumentVersionFindUnique.mockRejectedValue(new Error('DB error'));
  });

  it('does not re-throw to avoid blocking document processing', async () => {
    await expect(processSearchIndexJob(makeIndexJob())).resolves.not.toThrow();
  });
});
