/**
 * Admin Document Download API — scan-gate + current-version coverage.
 *
 * Download serves the document's CURRENT version (currentVersionId), not the
 * highest version number. It 403s if the current version is not servable and
 * never silently downgrades to an older servable version. The version-loading
 * mock is keyed by `where.id`, so these tests fail if the route stops resolving
 * currentVersionId (e.g. reverts to "highest version").
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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
  ACCESS_AUDIT_DEDUPE_MS: { DOCUMENT_DOWNLOADED: 3_000 },
  captureAccessAudit: (...args: unknown[]) => mockCaptureAccessAudit(...args),
}));

const mockStorage = { exists: vi.fn(), get: vi.fn() };
vi.mock('@/providers', () => ({
  getProviders: () => ({ storage: mockStorage }),
}));

const mockDocFindFirst = vi.fn();
const mockDocUpdate = vi.fn();
const mockVersionFindFirst = vi.fn();
const mockTx = {
  room: { findFirst: vi.fn() },
  document: { findFirst: mockDocFindFirst, update: mockDocUpdate },
  documentVersion: { findFirst: mockVersionFindFirst },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET } from './route';

function makeRequest(): NextRequest {
  return new NextRequest(
    new URL('http://localhost:3000/api/rooms/room-1/documents/doc-1/download')
  );
}
function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1' }) };
}

function blob(name: string) {
  return { storageKey: `documents/org-1/${name}`, storageBucket: 'documents' };
}

// The DB "stores" two versions; the mock returns the one asked for by id.
const VERSIONS: Record<string, { scanStatus: string; fileBlob: unknown }> = {
  'ver-1': { scanStatus: 'CLEAN', fileBlob: blob('v1.pdf') },
  'ver-2': { scanStatus: 'CLEAN', fileBlob: blob('v2.pdf') },
};

describe('GET /api/rooms/:roomId/documents/:documentId/download — current version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureAccessAudit.mockResolvedValue('disabled');
    mockTx.room.findFirst.mockResolvedValue({ id: 'room-1', organizationId: 'org-1' });
    mockDocUpdate.mockResolvedValue({});
    mockStorage.exists.mockResolvedValue(true);
    mockStorage.get.mockResolvedValue(Buffer.from('bytes'));
    // Reset both versions to CLEAN each test.
    VERSIONS['ver-1'] = { scanStatus: 'CLEAN', fileBlob: blob('v1.pdf') };
    VERSIONS['ver-2'] = { scanStatus: 'CLEAN', fileBlob: blob('v2.pdf') };
    // Behave like the scoped DB lookup: resolve a version only when id,
    // documentId AND organizationId all match. A regression that drops a scoping
    // predicate (or a hostile cross-tenant currentVersionId pointer) then fails.
    mockVersionFindFirst.mockImplementation(
      (args: { where?: { id?: string; documentId?: string; organizationId?: string } }) => {
        const w = args?.where ?? {};
        if (w.documentId !== 'doc-1' || w.organizationId !== 'org-1') {
          return Promise.resolve(null);
        }
        return Promise.resolve(w.id ? (VERSIONS[w.id] ?? null) : null);
      }
    );
  });

  function docWithCurrent(currentVersionId: string | null) {
    mockDocFindFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'file.pdf',
      mimeType: 'application/pdf',
      currentVersionId,
    });
  }

  it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
    'returns 403 and reads no bytes when the CURRENT version is %s (no downgrade to older clean)',
    async (scanStatus) => {
      // Current is v2 (non-servable); v1 is CLEAN and must NOT be served instead.
      VERSIONS['ver-2'] = { scanStatus, fileBlob: blob('v2.pdf') };
      docWithCurrent('ver-2');

      const res = await GET(makeRequest(), makeContext());

      expect(res.status).toBe(403);
      expect(mockStorage.get).not.toHaveBeenCalled();
      expect(mockDocUpdate).not.toHaveBeenCalled();
    }
  );

  it('serves the current version (v2), not merely the highest', async () => {
    docWithCurrent('ver-2');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorage.get).toHaveBeenCalledWith('documents', 'documents/org-1/v2.pdf');
    expect(mockCaptureAccessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DOCUMENT_DOWNLOADED',
        roomId: 'room-1',
        documentId: 'doc-1',
        dedupeWindowMs: 3_000,
      })
    );
  });

  it('after rollback (current=v1) serves v1 even though v2 is newer and CLEAN', async () => {
    docWithCurrent('ver-1');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorage.get).toHaveBeenCalledWith('documents', 'documents/org-1/v1.pdf');
    expect(mockStorage.get).not.toHaveBeenCalledWith('documents', 'documents/org-1/v2.pdf');
  });

  it('serves a SKIPPED current version (200)', async () => {
    VERSIONS['ver-2'] = { scanStatus: 'SKIPPED', fileBlob: blob('v2.pdf') };
    docWithCurrent('ver-2');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorage.get).toHaveBeenCalled();
  });

  it('falls back to highest servable when there is no current pointer (legacy doc)', async () => {
    docWithCurrent(null);
    // Legacy branch queries with a scanStatus filter and no id; return v2.
    mockVersionFindFirst.mockImplementation(
      (args: { where?: { id?: string; documentId?: string; organizationId?: string } }) => {
        const w = args?.where ?? {};
        if (w.documentId !== 'doc-1' || w.organizationId !== 'org-1') {
          return Promise.resolve(null);
        }
        return Promise.resolve(w.id ? null : VERSIONS['ver-2']);
      }
    );

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorage.get).toHaveBeenCalledWith('documents', 'documents/org-1/v2.pdf');
  });

  it('returns 404 and reads no bytes for a hostile currentVersionId that does not belong to this document/org', async () => {
    // The scoped mock only resolves versions of doc-1/org-1; a pointer to some
    // other version id resolves to nothing.
    docWithCurrent('ver-from-another-tenant');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(404);
    expect(mockStorage.get).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 (not 404) when the current version is INFECTED even if its file blob is missing', async () => {
    VERSIONS['ver-2'] = { scanStatus: 'INFECTED', fileBlob: null };
    docWithCurrent('ver-2');

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(403);
    expect(mockStorage.get).not.toHaveBeenCalled();
  });
});
