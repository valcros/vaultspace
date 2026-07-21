import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Scan-gate coverage for the viewer preview route (external share-token surface).
 * The version query is mocked to behave like the real DB: the stored row is
 * returned only when the query's scanStatus filter admits its status. A gated
 * query finds nothing for an INFECTED row, so this test would FAIL if the
 * SERVABLE_SCAN_STATUS_FILTER were dropped (the row would be returned and its
 * preview served).
 */

const mockCookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const mockViewSessionFindFirst = vi.fn();
const mockWithOrgContext = vi.fn();
const mockDocFindFirst = vi.fn();
const mockVersionFindFirst = vi.fn();
const mockStorageExists = vi.fn().mockResolvedValue(true);
const mockStorageGet = vi.fn().mockResolvedValue(Buffer.from('preview-png'));

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
  return new NextRequest('http://localhost:3000/api/view/share-token/documents/doc-1/preview');
}

let storedVersion: { id: string; scanStatus: string; previewAssets: unknown[] } | null;

describe('GET /api/view/[shareToken]/documents/[documentId]/preview — scan gate', () => {
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
        permission: 'VIEW',
        scope: 'ROOM',
        scopedFolderId: null,
        scopedDocumentId: null,
        maxSessionMinutes: 30,
      },
      room: { id: 'room-1', allowViewerVersionHistory: true },
    });

    mockDocFindFirst.mockResolvedValue({ id: 'doc-1', currentVersionId: 'ver-1' });
    mockStorageExists.mockResolvedValue(true);
    mockStorageGet.mockResolvedValue(Buffer.from('preview-png'));

    storedVersion = {
      id: 'ver-1',
      scanStatus: 'CLEAN',
      previewAssets: [{ storageKey: 'previews/doc-1/ver-1/page-1.png', mimeType: 'image/png' }],
    };

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
          document: { findFirst: mockDocFindFirst },
          documentVersion: { findFirst: mockVersionFindFirst },
        })
    );
  });

  it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
    'returns 404 and never reads preview bytes for a %s version',
    async (scanStatus) => {
      storedVersion!.scanStatus = scanStatus;

      const res = await GET(makeRequest(), makeContext());

      expect(res.status).toBe(404);
      expect(mockStorageGet).not.toHaveBeenCalled();
    }
  );

  it('serves a CLEAN version preview (200, bytes read)', async () => {
    storedVersion!.scanStatus = 'CLEAN';

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalledWith('previews', 'previews/doc-1/ver-1/page-1.png');
  });

  it('serves a SKIPPED (allowed-but-unscanned) version preview (200)', async () => {
    storedVersion!.scanStatus = 'SKIPPED';

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalled();
  });
});
