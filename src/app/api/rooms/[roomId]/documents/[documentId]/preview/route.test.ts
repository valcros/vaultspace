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
  user: { email: 'user@example.com' },
  organization: { role: 'ADMIN' as const },
};
vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
  requireAuth: vi.fn(() => Promise.resolve(mockSession)),
}));

const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');
vi.mock('@/lib/audit/accessAudit', () => ({
  ACCESS_AUDIT_DEDUPE_MS: { DOCUMENT_VIEWED: 300_000 },
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
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

function makeRequest(query = ''): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/rooms/room-1/documents/doc-1/preview${query}`)
  );
}

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1' }) };
}

const mockRoom = { id: 'room-1', organizationId: 'org-1' };
const fileBlob = { storageKey: 'files/test.bin', storageBucket: 'documents' };

function makeDocument(mimeType: string, currentVersionId: string | null = 'ver-current') {
  return {
    id: 'doc-1',
    name: 'test-file',
    mimeType,
    currentVersionId,
  };
}

function makeVersion(mimeType: string, previewAssets: unknown[] = [], scanStatus = 'CLEAN') {
  return {
    versionNumber: 1,
    mimeType,
    fileBlob,
    previewAssets,
    scanStatus,
  };
}

describe('GET /api/rooms/:roomId/documents/:documentId/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureAccessAudit.mockResolvedValue('disabled');
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.document.update.mockResolvedValue({});
    mockTx.previewAsset.count.mockResolvedValue(1);
    mockStorage.exists.mockResolvedValue(true);
    mockStorage.get.mockResolvedValue(Buffer.from('file content'));
    mockStorage.getSignedUrl.mockResolvedValue('https://storage.example.com/signed?sig=abc');
  });

  it('returns 400 before database access for malformed route identifiers', async () => {
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ roomId: 'room-1', documentId: '' }),
    });

    expect(res.status).toBe(400);
    expect(mockTx.room.findFirst).not.toHaveBeenCalled();
  });

  it.each(['?page=0', '?page=not-a-number', '?page=10001', '?versionId=%20'])(
    'returns 400 before database access for malformed preview query %s',
    async (query) => {
      const res = await GET(makeRequest(query), makeContext());

      expect(res.status).toBe(400);
      expect(mockTx.room.findFirst).not.toHaveBeenCalled();
    }
  );

  it('captures a successful document view and remains available on audit failure', async () => {
    mockCaptureAccessAudit.mockResolvedValue('failed');
    mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf'));
    mockTx.documentVersion.findFirst.mockResolvedValue(makeVersion('application/pdf'));

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DOCUMENT_VIEWED',
        roomId: 'room-1',
        documentId: 'doc-1',
        dedupeWindowMs: 300_000,
      })
    );
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

  // Scan gate: an INFECTED / still-scanning original must never have a preview
  // served, even when the selected version and its blob exist.
  describe('scan gate', () => {
    it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
      'returns 403 and serves nothing for a %s version',
      async (scanStatus) => {
        mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf'));
        mockTx.documentVersion.findFirst.mockResolvedValue(
          makeVersion('application/pdf', [], scanStatus)
        );

        const res = await GET(makeRequest(), makeContext());

        expect(res.status).toBe(403);
        expect(mockStorage.get).not.toHaveBeenCalled();
      }
    );

    it('serves a SKIPPED (allowed-but-unscanned) version', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf'));
      mockTx.documentVersion.findFirst.mockResolvedValue(
        makeVersion('application/pdf', [], 'SKIPPED')
      );

      const res = await GET(makeRequest(), makeContext());

      expect(res.status).toBe(200);
    });
  });

  // Default preview follows currentVersionId, never the highest version number.
  describe('current version', () => {
    // DB-like store keyed by version id.
    const rows: Record<string, ReturnType<typeof makeVersion>> = {};
    beforeEach(() => {
      rows['ver-1'] = makeVersion('application/pdf', [], 'CLEAN');
      rows['ver-2'] = makeVersion('application/pdf', [], 'CLEAN');
      // Scoped like the DB: resolve only when id, documentId AND organizationId
      // all match (guards tenant scoping + hostile currentVersionId pointers).
      mockTx.documentVersion.findFirst.mockImplementation(
        (args: { where?: { id?: string; documentId?: string; organizationId?: string } }) => {
          const w = args?.where ?? {};
          if (w.documentId !== 'doc-1' || w.organizationId !== 'org-1') {
            return Promise.resolve(null);
          }
          return Promise.resolve(w.id ? (rows[w.id] ?? null) : null);
        }
      );
    });

    it.each(['INFECTED', 'PENDING'])(
      'returns 403 and never previews an older clean version when current is %s',
      async (scanStatus) => {
        rows['ver-2'] = makeVersion('application/pdf', [], scanStatus);
        mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf', 'ver-2'));

        const res = await GET(makeRequest(), makeContext());

        expect(res.status).toBe(403);
        expect(mockStorage.get).not.toHaveBeenCalled();
      }
    );

    it('after rollback (current=ver-1) previews ver-1, not the newer ver-2', async () => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument('application/pdf', 'ver-1'));

      const res = await GET(makeRequest(), makeContext());

      expect(res.status).toBe(200);
      // ver-1's blob was fetched (both fixtures share the same fileBlob key, so
      // assert the current version was the one loaded).
      expect(mockTx.documentVersion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'ver-1' }) })
      );
    });
  });
});
