import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Scan-gate coverage for the viewer download route -- the external, share-token
 * attack surface. The version query is mocked to behave like the real DB: a row
 * is returned only when the query's scanStatus filter matches its status. So a
 * gated query (constrained to CLEAN/SKIPPED) finds nothing for an INFECTED row,
 * and this test would FAIL if the SERVABLE_SCAN_STATUS_FILTER were removed --
 * the ungated query would return the infected row and the route would serve it.
 */

const mockCookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const mockViewSessionFindFirst = vi.fn();
const mockWithOrgContext = vi.fn();
const mockDocFindFirst = vi.fn();
const mockDocUpdate = vi.fn().mockResolvedValue({});
const mockVersionFindFirst = vi.fn();
const mockStorageExists = vi.fn().mockResolvedValue(true);
const mockStorageGet = vi.fn().mockResolvedValue(Buffer.from('original-bytes'));

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => mockCookieStore) }));

vi.mock('@/lib/db', () => ({
  db: { viewSession: { findFirst: (...a: unknown[]) => mockViewSessionFindFirst(...a) } },
  bootstrapDb: { viewSession: { findFirst: (...a: unknown[]) => mockViewSessionFindFirst(...a) } },
  withOrgContext: (...a: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...a),
}));

vi.mock('@/providers', () => ({
  getProviders: () => ({ storage: { exists: mockStorageExists, get: mockStorageGet } }),
}));

import { GET } from './route';

function makeContext(shareToken = 'share-token') {
  return { params: Promise.resolve({ shareToken, documentId: 'doc-1' }) };
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/view/share-token/documents/doc-1/download');
}

// The single version row the mocked DB "stores"; tests set its scanStatus.
let storedVersion: { id: string; scanStatus: string; fileBlob: unknown } | null;

describe('GET /api/view/[shareToken]/documents/[documentId]/download — scan gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCookieStore.get.mockReturnValue({ value: 'viewer-session-token' });
    mockViewSessionFindFirst.mockResolvedValue({
      id: 'view-session-1',
      createdAt: new Date(),
      isActive: true,
      organizationId: 'org-1',
      link: {
        slug: 'share-token',
        isActive: true,
        permission: 'DOWNLOAD',
        scope: 'ROOM',
        scopedFolderId: null,
        scopedDocumentId: null,
        maxSessionMinutes: 30,
      },
      room: { id: 'room-1', allowDownloads: true, allowViewerVersionHistory: true },
    });

    mockDocFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'file.pdf',
      mimeType: 'application/pdf',
      allowDownload: true,
    });
    mockStorageExists.mockResolvedValue(true);
    mockStorageGet.mockResolvedValue(Buffer.from('original-bytes'));

    storedVersion = {
      id: 'ver-1',
      scanStatus: 'CLEAN',
      fileBlob: { storageKey: 'documents/org-1/file.pdf', storageBucket: 'documents' },
    };

    // Simulate the real DB: return the stored row only when the query's
    // scanStatus filter (if any) admits its status.
    mockVersionFindFirst.mockImplementation((args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      const filter = where['scanStatus'] as { in?: string[] } | undefined;
      const gated = Array.isArray(filter?.in);
      if (gated && storedVersion && !filter!.in!.includes(storedVersion.scanStatus)) {
        return Promise.resolve(null);
      }
      return Promise.resolve(storedVersion);
    });

    mockWithOrgContext.mockImplementation(
      async (_orgId: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          document: { findFirst: mockDocFindFirst, update: mockDocUpdate },
          documentVersion: { findFirst: mockVersionFindFirst },
        })
    );
  });

  it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
    'returns 404 and never reads bytes for a %s latest version',
    async (scanStatus) => {
      storedVersion!.scanStatus = scanStatus;

      const res = await GET(makeRequest(), makeContext());

      expect(res.status).toBe(404);
      expect(mockStorageGet).not.toHaveBeenCalled();
      expect(mockDocUpdate).not.toHaveBeenCalled(); // download not counted
    }
  );

  it('serves a CLEAN version (200, bytes read)', async () => {
    storedVersion!.scanStatus = 'CLEAN';

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalledWith('documents', 'documents/org-1/file.pdf');
  });

  it('serves a SKIPPED (allowed-but-unscanned) version (200)', async () => {
    storedVersion!.scanStatus = 'SKIPPED';

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalled();
  });
});
