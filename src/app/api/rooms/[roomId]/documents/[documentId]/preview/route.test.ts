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
  getSignedUrl: vi.fn(),
};

// Mock providers
const mockAddJob = vi.fn(() => Promise.resolve());
vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: mockStorage,
    job: { addJob: mockAddJob },
  }),
}));

// Mock DB transaction
const mockTx = {
  room: { findFirst: vi.fn() },
  document: { findFirst: vi.fn(), update: vi.fn() },
  documentVersion: { findFirst: vi.fn() },
  previewAsset: { count: vi.fn().mockResolvedValue(1) },
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

function makeDocument(mimeType: string) {
  return {
    id: 'doc-1',
    name: 'test-file',
    mimeType,
  };
}

function makeVersion(mimeType: string, previewAssets: unknown[] = []) {
  return {
    versionNumber: 1,
    mimeType,
    fileBlob,
    previewAssets,
  };
}

describe('GET /api/rooms/:roomId/documents/:documentId/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.document.update.mockResolvedValue({});
    mockTx.previewAsset.count.mockResolvedValue(1);
    mockStorage.exists.mockResolvedValue(true);
    mockStorage.get.mockResolvedValue(Buffer.from('file content'));
    mockStorage.getSignedUrl.mockResolvedValue('https://storage.example.com/signed?sig=abc');
  });

  describe('text-renderable MIME types served inline', () => {
    it('serves text/markdown with correct Content-Type', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('text/markdown'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('text/markdown'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/markdown');
    });

    it('serves application/json with correct Content-Type', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('application/json'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('application/json'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
    });

    it('serves text/html as text/plain for XSS defense', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('text/html'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('text/html'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/plain');
    });
  });

  describe('all previews are app-served (QA regression: cross-origin redirects broke viewers)', () => {
    it('serves PDF inline with content headers', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('application/pdf'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toContain('inline');
      expect(mockStorage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('serves image/png inline', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('image/png'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('image/png'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(mockStorage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('keeps image/svg+xml app-served (no redirect)', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('image/svg+xml'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('image/svg+xml'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
      expect(mockStorage.getSignedUrl).not.toHaveBeenCalled();
      expect(await res.text()).toBe('file content');
    });

    it('keeps text previews app-served with body intact', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('text/plain'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('text/plain'));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(mockStorage.getSignedUrl).not.toHaveBeenCalled();
      expect(await res.text()).toBe('file content');
    });
  });

  describe('non-previewable types', () => {
    it('returns 404 with canPreview:false for XLSX without preview asset', async () => {
      const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      mockTx.document.findFirst.mockResolvedValue(makeDocument(xlsxType));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion(xlsxType));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.document.canPreview).toBe(false);
    });

    it('serves converted PNG render app-side (ConvertedPreview consumes via fetch)', async () => {
      const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const previewAsset = {
        assetType: 'RENDER',
        storageKey: 'previews/doc-1.png',
        mimeType: 'image/png',
        pageNumber: 1,
      };
      mockTx.document.findFirst.mockResolvedValue(makeDocument(xlsxType));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion(xlsxType, [previewAsset]));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(mockStorage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('serves converted PDF preview asset app-side', async () => {
      const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const previewAsset = {
        assetType: 'PDF',
        storageKey: 'previews/doc-1.pdf',
        mimeType: 'application/pdf',
        pageNumber: 1,
      };
      mockTx.document.findFirst.mockResolvedValue(makeDocument(docxType));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion(docxType, [previewAsset]));
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(mockStorage.getSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('view counting moved to job path', () => {
    it('does not increment viewCount in the request path', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('application/pdf'));
      await GET(makeRequest(), makeContext());
      expect(mockTx.document.update).not.toHaveBeenCalled();
    });

    it('queues notify-document-viewed with incrementViewCount flag', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf'));
      mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('application/pdf'));
      await GET(makeRequest(), makeContext());
      expect(mockAddJob).toHaveBeenCalledWith(
        'normal',
        'notify-document-viewed',
        expect.objectContaining({
          organizationId: 'org-1',
          roomId: 'room-1',
          documentId: 'doc-1',
          viewerId: 'user-1',
          incrementViewCount: true,
        })
      );
    });
  });
});
