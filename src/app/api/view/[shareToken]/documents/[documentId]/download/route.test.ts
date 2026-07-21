import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Scan-gate + current-version coverage for the viewer download route -- the
 * external share-token surface.
 *
 * Default download serves the document's CURRENT version (currentVersionId), not
 * the highest version number. A non-servable current version yields 404 (viewers
 * are not told whether it is scanning or blocked) and NEVER silently falls back
 * to an older servable version. The version-loading mock is keyed by `where.id`,
 * so these tests fail if the route stops resolving currentVersionId.
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
function blob(name: string) {
  return { storageKey: `documents/org-1/${name}`, storageBucket: 'documents' };
}

// The DB "stores" two versions; the id-keyed mock returns the one requested.
const VERSIONS: Record<string, { scanStatus: string; fileBlob: unknown }> = {
  'ver-1': { scanStatus: 'CLEAN', fileBlob: blob('v1.pdf') },
  'ver-2': { scanStatus: 'CLEAN', fileBlob: blob('v2.pdf') },
};

describe('GET /api/view/[shareToken]/documents/[documentId]/download — current version', () => {
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

    mockStorageExists.mockResolvedValue(true);
    mockStorageGet.mockResolvedValue(Buffer.from('original-bytes'));

    VERSIONS['ver-1'] = { scanStatus: 'CLEAN', fileBlob: blob('v1.pdf') };
    VERSIONS['ver-2'] = { scanStatus: 'CLEAN', fileBlob: blob('v2.pdf') };

    mockVersionFindFirst.mockImplementation((args: { where?: { id?: string } }) =>
      Promise.resolve(args?.where?.id ? (VERSIONS[args.where.id] ?? null) : null)
    );

    mockWithOrgContext.mockImplementation(
      async (_orgId: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          document: { findFirst: mockDocFindFirst, update: mockDocUpdate },
          documentVersion: { findFirst: mockVersionFindFirst },
        })
    );
  });

  function docWithCurrent(currentVersionId: string | null) {
    mockDocFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'file.pdf',
      mimeType: 'application/pdf',
      allowDownload: true,
      currentVersionId,
    });
  }

  it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
    'returns 404 and reads no bytes when the CURRENT version is %s (no downgrade)',
    async (scanStatus) => {
      VERSIONS['ver-2'] = { scanStatus, fileBlob: blob('v2.pdf') };
      docWithCurrent('ver-2');

      const res = await GET(makeRequest(), makeContext());

      expect(res.status).toBe(404);
      expect(mockStorageGet).not.toHaveBeenCalled();
      expect(mockDocUpdate).not.toHaveBeenCalled();
    }
  );

  it('serves the current version (v2)', async () => {
    docWithCurrent('ver-2');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalledWith('documents', 'documents/org-1/v2.pdf');
  });

  it('after rollback (current=v1) serves v1, not the newer CLEAN v2', async () => {
    docWithCurrent('ver-1');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalledWith('documents', 'documents/org-1/v1.pdf');
    expect(mockStorageGet).not.toHaveBeenCalledWith('documents', 'documents/org-1/v2.pdf');
  });

  it('serves a SKIPPED current version (200)', async () => {
    VERSIONS['ver-2'] = { scanStatus: 'SKIPPED', fileBlob: blob('v2.pdf') };
    docWithCurrent('ver-2');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalled();
  });
});
