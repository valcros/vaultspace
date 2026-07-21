import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Scan-gate + current-version coverage for the viewer preview route (external
 * share-token surface).
 *
 * Default preview follows the document's CURRENT version (currentVersionId), not
 * the highest version number. A non-servable current version yields 404 and never
 * silently downgrades to an older servable version. The version-loading mock is
 * keyed by `where.id`, so these tests fail if the route stops resolving
 * currentVersionId.
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

function renderAsset(name: string) {
  return [{ storageKey: `previews/${name}`, mimeType: 'image/png' }];
}

// The DB "stores" two versions; the id-keyed mock returns the one requested.
const VERSIONS: Record<string, { id: string; scanStatus: string; previewAssets: unknown[] }> = {
  'ver-1': { id: 'ver-1', scanStatus: 'CLEAN', previewAssets: renderAsset('v1.png') },
  'ver-2': { id: 'ver-2', scanStatus: 'CLEAN', previewAssets: renderAsset('v2.png') },
};

describe('GET /api/view/[shareToken]/documents/[documentId]/preview — current version', () => {
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

    mockStorageExists.mockResolvedValue(true);
    mockStorageGet.mockResolvedValue(Buffer.from('preview-png'));

    VERSIONS['ver-1'] = { id: 'ver-1', scanStatus: 'CLEAN', previewAssets: renderAsset('v1.png') };
    VERSIONS['ver-2'] = { id: 'ver-2', scanStatus: 'CLEAN', previewAssets: renderAsset('v2.png') };

    // Scoped like the DB: resolve only when id, documentId AND organizationId
    // all match (guards tenant scoping + hostile currentVersionId pointers).
    mockVersionFindFirst.mockImplementation(
      (args: { where?: { id?: string; documentId?: string; organizationId?: string } }) => {
        const w = args?.where ?? {};
        if (w.documentId !== 'doc-1' || w.organizationId !== 'org-1') {
          return Promise.resolve(null);
        }
        return Promise.resolve(w.id ? (VERSIONS[w.id] ?? null) : null);
      }
    );

    mockWithOrgContext.mockImplementation(
      async (_orgId: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          document: { findFirst: mockDocFindFirst },
          documentVersion: { findFirst: mockVersionFindFirst },
        })
    );
  });

  function docWithCurrent(currentVersionId: string | null) {
    mockDocFindFirst.mockResolvedValue({ id: 'doc-1', currentVersionId });
  }

  it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
    'returns 404 and reads no preview bytes when the CURRENT version is %s (no downgrade)',
    async (scanStatus) => {
      VERSIONS['ver-2'] = { id: 'ver-2', scanStatus, previewAssets: renderAsset('v2.png') };
      docWithCurrent('ver-2');

      const res = await GET(makeRequest(), makeContext());

      expect(res.status).toBe(404);
      expect(mockStorageGet).not.toHaveBeenCalled();
    }
  );

  it('serves the current version preview (v2)', async () => {
    docWithCurrent('ver-2');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalledWith('previews', 'previews/v2.png');
  });

  it('after rollback (current=v1) previews v1, not the newer CLEAN v2', async () => {
    docWithCurrent('ver-1');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalledWith('previews', 'previews/v1.png');
    expect(mockStorageGet).not.toHaveBeenCalledWith('previews', 'previews/v2.png');
  });

  it('serves a SKIPPED current version preview (200)', async () => {
    VERSIONS['ver-2'] = {
      id: 'ver-2',
      scanStatus: 'SKIPPED',
      previewAssets: renderAsset('v2.png'),
    };
    docWithCurrent('ver-2');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalled();
  });
});
