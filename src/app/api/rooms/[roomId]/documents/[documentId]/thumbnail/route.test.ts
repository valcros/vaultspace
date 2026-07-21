/**
 * Thumbnail API Route Tests
 *
 * Tests stored thumbnail serving, placeholder fallback, and job enqueuing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to define mocks referenced in vi.mock factories
const { mockStorageExists, mockStorageGet, mockJobAddJob, mockDocument, extraVersions } =
  vi.hoisted(() => ({
    mockStorageExists: vi.fn().mockResolvedValue(true),
    mockStorageGet: vi.fn().mockResolvedValue(Buffer.alloc(5000)),
    mockJobAddJob: vi.fn().mockResolvedValue('job-1'),
    // Additional stored versions (besides mockDocument.versions[0]); tests push
    // a second version here to exercise current-vs-highest selection.
    extraVersions: [] as Array<{ id: string; scanStatus: string; previewAssets: unknown[] }>,
    mockDocument: {
      id: 'doc-1',
      name: 'report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      currentVersionId: 'ver-1',
      versions: [
        {
          id: 'ver-1',
          scanStatus: 'CLEAN',
          fileBlob: {
            storageKey: 'documents/org-1/report.docx',
            storageBucket: 'documents',
          },
          previewAssets: [
            {
              id: 'thumb-1',
              assetType: 'THUMBNAIL',
              storageKey: 'thumbnails/doc-1/ver-1.png',
            },
          ],
        },
      ],
    },
  }));

// Mock sharp
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('placeholder-png')),
  })),
}));

// Mock auth
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    organizationId: 'org-1',
    userId: 'user-1',
  }),
}));

// Mock providers
vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: {
      exists: mockStorageExists,
      get: mockStorageGet,
    },
    job: {
      addJob: mockJobAddJob,
    },
    preview: {
      generateThumbnailPng: vi.fn().mockResolvedValue(Buffer.from('thumb')),
    },
  }),
}));

// Mock DB
vi.mock('@/lib/db', () => ({
  withOrgContext: vi
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) => {
      const mockTx = {
        room: {
          findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }),
        },
        document: {
          findFirst: vi.fn().mockResolvedValue(mockDocument),
        },
        documentVersion: {
          // Behave like the scoped DB lookup: only resolve a version when id,
          // documentId AND organizationId all match. Tests fail if the route
          // drops a scoping predicate or stops resolving currentVersionId.
          findFirst: vi
            .fn()
            .mockImplementation(
              (args: { where?: { id?: string; documentId?: string; organizationId?: string } }) => {
                const w = args?.where ?? {};
                if (w.documentId !== 'doc-1' || w.organizationId !== 'org-1') {
                  return Promise.resolve(null);
                }
                const all = [mockDocument.versions[0], ...extraVersions];
                if (w.id) {
                  return Promise.resolve(all.find((v) => v?.id === w.id) ?? null);
                }
                return Promise.resolve(null);
              }
            ),
        },
      };
      return fn(mockTx);
    }),
}));

// Mock deployment capabilities - assume all capabilities available in tests
vi.mock('@/lib/deployment-capabilities', () => ({
  hasCapability: vi.fn().mockReturnValue(true),
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

function createRequest() {
  return new NextRequest('http://localhost/api/rooms/room-1/documents/doc-1/thumbnail');
}

function createContext() {
  return {
    params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1' }),
  };
}

describe('GET /api/rooms/:roomId/documents/:documentId/thumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageExists.mockResolvedValue(true);
    mockStorageGet.mockResolvedValue(Buffer.alloc(5000));
    // Shared mutable fixture: reset the scan status to servable before each test
    // so a gate test's INFECTED override can't leak into the next test.
    mockDocument.versions[0]!.scanStatus = 'CLEAN';
    mockDocument.currentVersionId = 'ver-1';
    extraVersions.length = 0;
  });

  it('serves stored thumbnail with correct headers', async () => {
    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400, immutable');
    expect(response.headers.get('ETag')).toBeTruthy();
  });

  it('serves stored thumbnail for ALL types including PDF', async () => {
    // Previously PDF was skipped — now it should be served
    mockDocument.mimeType = 'application/pdf';
    mockDocument.name = 'document.pdf';

    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');

    // Restore
    mockDocument.mimeType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    mockDocument.name = 'report.docx';
  });

  it('returns placeholder and enqueues job when no thumbnail stored', async () => {
    mockDocument.versions[0]!.previewAssets = [];

    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');

    expect(mockJobAddJob).toHaveBeenCalledWith(
      'high',
      'preview.generate',
      expect.objectContaining({
        documentId: 'doc-1',
        versionId: 'ver-1',
      }),
      expect.objectContaining({ jobId: 'preview-ver-1' })
    );

    // Restore
    mockDocument.versions[0]!.previewAssets = [
      {
        id: 'thumb-1',
        assetType: 'THUMBNAIL',
        storageKey: 'thumbnails/doc-1/ver-1.png',
      },
    ];
  });

  it('returns placeholder when stored thumbnail is too small', async () => {
    mockStorageGet.mockResolvedValue(Buffer.alloc(500)); // <1000 bytes

    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');
  });

  it('returns placeholder when stored thumbnail fetch fails', async () => {
    // The exists() pre-check was removed (audit finding 5-adjacent): a failed
    // get falls through to the placeholder path instead.
    mockStorageGet.mockRejectedValueOnce(new Error('not found'));

    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');
  });

  it('never returns 404 when document has a file blob', async () => {
    mockDocument.versions[0]!.previewAssets = [];
    mockStorageExists.mockResolvedValue(false);

    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(200);

    // Restore
    mockDocument.versions[0]!.previewAssets = [
      {
        id: 'thumb-1',
        assetType: 'THUMBNAIL',
        storageKey: 'thumbnails/doc-1/ver-1.png',
      },
    ];
  });

  it('handles job enqueue failure gracefully', async () => {
    mockDocument.versions[0]!.previewAssets = [];
    mockJobAddJob.mockRejectedValue(new Error('queue down'));

    const response = await GET(createRequest(), createContext());
    expect(response.status).toBe(200);

    // Restore
    mockDocument.versions[0]!.previewAssets = [
      {
        id: 'thumb-1',
        assetType: 'THUMBNAIL',
        storageKey: 'thumbnails/doc-1/ver-1.png',
      },
    ];
  });

  // Scan gate: an INFECTED / still-scanning original must never have its rendered
  // thumbnail served or (re)generated. The branded placeholder (derived from the
  // file name only) is still returned so the grid does not 404.
  describe('scan gate', () => {
    it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
      'serves the placeholder (not the stored thumbnail) and enqueues nothing for a %s version',
      async (scanStatus) => {
        mockDocument.versions[0]!.scanStatus = scanStatus;

        const response = await GET(createRequest(), createContext());

        // Still 200 (placeholder), but the stored thumbnail bytes are never read
        // and no preview/thumbnail generation is enqueued.
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');
        expect(mockStorageGet).not.toHaveBeenCalled();
        expect(mockJobAddJob).not.toHaveBeenCalled();
      }
    );

    it('serves the stored thumbnail for a SKIPPED (allowed-but-unscanned) version', async () => {
      mockDocument.versions[0]!.scanStatus = 'SKIPPED';

      const response = await GET(createRequest(), createContext());

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400, immutable');
    });
  });

  // Teeth against reverting to "highest version" selection: with a newer clean
  // version present, the grid must thumbnail the CURRENT (older) version.
  describe('current version', () => {
    beforeEach(() => {
      // A newer, CLEAN version 2 with its own stored thumbnail.
      extraVersions.push({
        id: 'ver-2',
        scanStatus: 'CLEAN',
        previewAssets: [
          { id: 'thumb-2', assetType: 'THUMBNAIL', storageKey: 'thumbnails/doc-1/ver-2.png' },
        ],
      });
    });

    it('reads the CURRENT version thumbnail (ver-1), never the newer ver-2', async () => {
      mockDocument.currentVersionId = 'ver-1'; // rolled back to older version

      const response = await GET(createRequest(), createContext());

      expect(response.status).toBe(200);
      expect(mockStorageGet).toHaveBeenCalledWith('previews', 'thumbnails/doc-1/ver-1.png');
      expect(mockStorageGet).not.toHaveBeenCalledWith('previews', 'thumbnails/doc-1/ver-2.png');
    });

    it('serves a placeholder (no stored-thumbnail read, no job) when the CURRENT version is INFECTED, even though ver-2 is clean', async () => {
      mockDocument.versions[0]!.scanStatus = 'INFECTED'; // ver-1 (current) is infected
      mockDocument.currentVersionId = 'ver-1';

      const response = await GET(createRequest(), createContext());

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');
      expect(mockStorageGet).not.toHaveBeenCalled();
      expect(mockJobAddJob).not.toHaveBeenCalled();
    });
  });
});
