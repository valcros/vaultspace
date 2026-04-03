/**
 * Thumbnail API Route Tests
 *
 * Tests stored thumbnail serving, placeholder fallback, and job enqueuing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to define mocks referenced in vi.mock factories
const { mockStorageExists, mockStorageGet, mockJobAddJob, mockDocument } = vi.hoisted(() => ({
  mockStorageExists: vi.fn().mockResolvedValue(true),
  mockStorageGet: vi.fn().mockResolvedValue(Buffer.alloc(5000)),
  mockJobAddJob: vi.fn().mockResolvedValue('job-1'),
  mockDocument: {
    id: 'doc-1',
    name: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    versions: [
      {
        id: 'ver-1',
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
  });

  it('serves stored thumbnail with correct headers', async () => {
    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
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
      expect.any(Object)
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

  it('returns placeholder when storage.exists returns false', async () => {
    mockStorageExists.mockResolvedValue(false);

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
});
