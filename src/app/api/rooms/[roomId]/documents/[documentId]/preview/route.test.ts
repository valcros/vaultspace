/**
 * Admin Document Preview API Tests
 *
 * Validates MIME type handling, XSS defense for HTML, and 404 for unavailable previews.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth
const mockSession = {
  userId: 'user-1',
  organizationId: 'org-1',
};
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(() => Promise.resolve(mockSession)),
}));

// Mock storage
const mockStorage = {
  exists: vi.fn(),
  get: vi.fn(),
};

// Mock providers
vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: mockStorage,
    job: { addJob: vi.fn(() => Promise.resolve()) },
  }),
}));

// Mock DB transaction
const mockTx = {
  room: { findFirst: vi.fn() },
  document: { findFirst: vi.fn(), update: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET } from './route';

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/rooms/room-1/documents/doc-1/preview'));
}

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1' }) };
}

const mockRoom = { id: 'room-1', organizationId: 'org-1' };
const fileBlob = { storageKey: 'files/test.bin', storageBucket: 'documents' };

function makeDocument(mimeType: string, previewAssets: unknown[] = []) {
  return {
    id: 'doc-1',
    name: 'test-file',
    mimeType,
    versions: [
      {
        versionNumber: 1,
        fileBlob,
        previewAssets,
      },
    ],
  };
}

describe('GET /api/rooms/:roomId/documents/:documentId/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.document.update.mockResolvedValue({});
    mockStorage.exists.mockResolvedValue(true);
    mockStorage.get.mockResolvedValue(Buffer.from('file content'));
  });

  describe('text-renderable MIME types served inline', () => {
    it('serves text/markdown with correct Content-Type', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('text/markdown'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/markdown');
    });

    it('serves application/json with correct Content-Type', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('application/json'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
    });

    it('serves text/html as text/plain for XSS defense', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('text/html'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/plain');
    });
  });

  describe('existing previewable types still work', () => {
    it('serves PDF inline', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
    });
  });

  describe('non-previewable types', () => {
    it('returns 404 with canPreview:false for XLSX without preview asset', async () => {
      mockTx.document.findFirst.mockResolvedValue(
        makeDocument('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      );
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.document.canPreview).toBe(false);
    });

    it('serves preview asset when available for XLSX', async () => {
      const previewAsset = {
        assetType: 'RENDER',
        storageKey: 'previews/doc-1.png',
        mimeType: 'image/png',
        pageNumber: 1,
      };
      mockTx.document.findFirst.mockResolvedValue(
        makeDocument('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', [
          previewAsset,
        ])
      );
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    });
  });
});
