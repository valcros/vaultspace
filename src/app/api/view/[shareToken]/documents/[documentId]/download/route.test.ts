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
const mockFolderFindFirst = vi.fn();
const mockVersionFindFirst = vi.fn();
const mockStorageExists = vi.fn().mockResolvedValue(true);
const mockStorageGet = vi.fn().mockResolvedValue(Buffer.from('original-bytes'));
const mockCaptureAccessAudit = vi.fn().mockResolvedValue('disabled');

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => mockCookieStore) }));

vi.mock('@/lib/db', () => ({
  db: { viewSession: { findFirst: (...a: unknown[]) => mockViewSessionFindFirst(...a) } },
  bootstrapDb: { viewSession: { findFirst: (...a: unknown[]) => mockViewSessionFindFirst(...a) } },
  withOrgContext: (...a: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...a),
}));

vi.mock('@/providers', () => ({
  getProviders: () => ({ storage: { exists: mockStorageExists, get: mockStorageGet } }),
}));

vi.mock('@/lib/middleware', () => ({
  getRequestContext: vi.fn(() => ({
    requestId: 'req-test',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  })),
}));

vi.mock('@/lib/audit/accessAudit', () => ({
  ACCESS_AUDIT_DEDUPE_MS: { DOCUMENT_DOWNLOADED: 3_000 },
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
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
    mockCaptureAccessAudit.mockResolvedValue('disabled');

    mockCookieStore.get.mockReturnValue({ value: 'viewer-session-token' });
    mockViewSessionFindFirst.mockResolvedValue({
      id: 'view-session-1',
      createdAt: new Date(),
      isActive: true,
      organizationId: 'org-1',
      visitorEmail: 'viewer@example.com',
      link: {
        slug: 'share-token',
        isActive: true,
        permission: 'DOWNLOAD',
        scope: 'ENTIRE_ROOM',
        scopedFolderId: null,
        scopedDocumentId: null,
        maxSessionMinutes: 30,
      },
      room: { id: 'room-1', allowDownloads: true, allowViewerVersionHistory: true },
    });

    mockStorageExists.mockResolvedValue(true);
    mockStorageGet.mockResolvedValue(Buffer.from('original-bytes'));
    mockFolderFindFirst.mockResolvedValue(null);

    VERSIONS['ver-1'] = { scanStatus: 'CLEAN', fileBlob: blob('v1.pdf') };
    VERSIONS['ver-2'] = { scanStatus: 'CLEAN', fileBlob: blob('v2.pdf') };

    // Scoped like the DB: resolve only when id, documentId AND organizationId
    // all match, and honor a scanStatus `in` filter when present (the historical
    // and legacy branches carry SERVABLE_SCAN_STATUS_FILTER). Guards tenant
    // scoping, hostile pointers, and the historical-path scan gate.
    mockVersionFindFirst.mockImplementation(
      (args: {
        where?: {
          id?: string;
          documentId?: string;
          organizationId?: string;
          scanStatus?: { in?: string[] };
        };
      }) => {
        const w = args?.where ?? {};
        if (w.documentId !== 'doc-1' || w.organizationId !== 'org-1') {
          return Promise.resolve(null);
        }
        const row = w.id ? VERSIONS[w.id] : null;
        if (row && w.scanStatus?.in && !w.scanStatus.in.includes(row.scanStatus)) {
          return Promise.resolve(null); // DB filter excludes a non-servable row
        }
        return Promise.resolve(row ?? null);
      }
    );

    mockWithOrgContext.mockImplementation(
      async (_orgId: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          document: { findFirst: mockDocFindFirst, update: mockDocUpdate },
          folder: { findFirst: mockFolderFindFirst },
          documentVersion: { findFirst: mockVersionFindFirst },
        })
    );
  });

  function docWithCurrent(currentVersionId: string | null) {
    mockDocFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'file.pdf',
      mimeType: 'application/pdf',
      folderId: null,
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
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DOCUMENT_DOWNLOADED',
        actorType: 'VIEWER',
        viewSessionId: 'view-session-1',
        actorEmail: 'viewer@example.com',
        touchViewerActivity: true,
      })
    );
  });

  it('keeps the download available when the bounded audit write fails', async () => {
    docWithCurrent('ver-2');
    mockCaptureAccessAudit.mockResolvedValue('failed');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe('original-bytes'.length);
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

  it('returns 404 and reads no bytes for a hostile currentVersionId not belonging to this document/org', async () => {
    docWithCurrent('ver-from-another-tenant');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(404);
    expect(mockStorageGet).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('allows download inside a room-bound folder-scoped link', async () => {
    const session = await mockViewSessionFindFirst();
    mockViewSessionFindFirst.mockResolvedValue({
      ...session,
      link: {
        ...session.link,
        scope: 'FOLDER',
        scopedFolderId: 'allowed-folder',
      },
    });
    mockDocFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'inside.pdf',
      mimeType: 'application/pdf',
      folderId: 'allowed-folder',
      allowDownload: true,
      currentVersionId: 'ver-2',
    });
    mockFolderFindFirst.mockResolvedValue({ parentId: null });

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockFolderFindFirst).toHaveBeenCalledWith({
      where: { id: 'allowed-folder', roomId: 'room-1' },
      select: { parentId: true },
    });
    expect(mockDocUpdate).toHaveBeenCalledTimes(1);
    expect(mockStorageGet).toHaveBeenCalled();
    expect(mockCaptureAccessAudit).toHaveBeenCalledTimes(1);
  });

  it('denies a document outside a folder-scoped link before counters, audit, or storage reads', async () => {
    const session = await mockViewSessionFindFirst();
    mockViewSessionFindFirst.mockResolvedValue({
      ...session,
      link: {
        ...session.link,
        scope: 'FOLDER',
        scopedFolderId: 'allowed-folder',
      },
    });
    mockDocFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'outside.pdf',
      mimeType: 'application/pdf',
      folderId: 'outside-folder',
      allowDownload: true,
      currentVersionId: 'ver-2',
    });
    mockFolderFindFirst.mockResolvedValue({ parentId: null });

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(404);
    expect(mockVersionFindFirst).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockStorageGet).not.toHaveBeenCalled();
    expect(mockCaptureAccessAudit).not.toHaveBeenCalled();
  });

  it('gates an explicit historical versionId: a non-servable historical version is 404, a servable one is served', async () => {
    docWithCurrent('ver-2'); // current is a distinct clean version
    const historicalReq = new NextRequest(
      'http://localhost:3000/api/view/share-token/documents/doc-1/download?versionId=ver-1'
    );

    // Historical ver-1 INFECTED -> filtered out -> 404, no bytes.
    VERSIONS['ver-1'] = { scanStatus: 'INFECTED', fileBlob: blob('v1.pdf') };
    const infected = await GET(historicalReq, makeContext());
    expect(infected.status).toBe(404);
    expect(mockStorageGet).not.toHaveBeenCalled();

    // Historical ver-1 CLEAN -> served.
    VERSIONS['ver-1'] = { scanStatus: 'CLEAN', fileBlob: blob('v1.pdf') };
    const clean = await GET(
      new NextRequest(
        'http://localhost:3000/api/view/share-token/documents/doc-1/download?versionId=ver-1'
      ),
      makeContext()
    );
    expect(clean.status).toBe(200);
    expect(mockStorageGet).toHaveBeenCalledWith('documents', 'documents/org-1/v1.pdf');
  });

  it('a PENDING and an INFECTED current version produce an identical response body', async () => {
    // Viewers must not be able to tell "still scanning" from "blocked".
    VERSIONS['ver-2'] = { scanStatus: 'PENDING', fileBlob: blob('v2.pdf') };
    docWithCurrent('ver-2');
    const pending = await GET(makeRequest(), makeContext());
    const pendingBody = await pending.json();

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
        scope: 'ENTIRE_ROOM',
        scopedFolderId: null,
        scopedDocumentId: null,
        maxSessionMinutes: 30,
      },
      room: { id: 'room-1', allowDownloads: true, allowViewerVersionHistory: true },
    });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          document: { findFirst: mockDocFindFirst, update: mockDocUpdate },
          folder: { findFirst: mockFolderFindFirst },
          documentVersion: { findFirst: mockVersionFindFirst },
        })
    );
    mockVersionFindFirst.mockImplementation(
      (args: { where?: { id?: string; documentId?: string; organizationId?: string } }) => {
        const w = args?.where ?? {};
        if (w.documentId !== 'doc-1' || w.organizationId !== 'org-1') {
          return Promise.resolve(null);
        }
        return Promise.resolve(
          w.id === 'ver-2' ? { scanStatus: 'INFECTED', fileBlob: blob('v2.pdf') } : null
        );
      }
    );
    docWithCurrent('ver-2');
    const infected = await GET(makeRequest(), makeContext());
    const infectedBody = await infected.json();

    expect(pending.status).toBe(infected.status);
    expect(pendingBody).toEqual(infectedBody);
  });
});
