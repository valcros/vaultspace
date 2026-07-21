import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Scan-gate coverage for the viewer version-history route (external share-token
 * surface). findMany is mocked to behave like the real DB: it returns only the
 * rows whose scanStatus the query admits. So a non-servable version must never
 * appear in the list, and this test would FAIL if the SERVABLE_SCAN_STATUS_FILTER
 * were dropped (the INFECTED version would leak into the listing).
 */

const mockCookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const mockViewSessionFindFirst = vi.fn();
const mockWithOrgContext = vi.fn();
const mockDocFindFirst = vi.fn();
const mockVersionFindMany = vi.fn();

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => mockCookieStore) }));

vi.mock('@/lib/db', () => ({
  db: { viewSession: { findFirst: (...a: unknown[]) => mockViewSessionFindFirst(...a) } },
  bootstrapDb: { viewSession: { findFirst: (...a: unknown[]) => mockViewSessionFindFirst(...a) } },
  withOrgContext: (...a: Parameters<typeof mockWithOrgContext>) => mockWithOrgContext(...a),
}));

import { GET } from './route';

function makeContext(shareToken = 'share-token') {
  return { params: Promise.resolve({ shareToken, documentId: 'doc-1' }) };
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/view/share-token/documents/doc-1/versions');
}

const CLEAN_VERSION = {
  id: 'ver-1',
  versionNumber: 1,
  fileSize: BigInt(100),
  createdAt: new Date('2024-01-01'),
  scanStatus: 'CLEAN',
  previewAssets: [],
};
const INFECTED_VERSION = {
  id: 'ver-2',
  versionNumber: 2,
  fileSize: BigInt(200),
  createdAt: new Date('2024-01-02'),
  scanStatus: 'INFECTED',
  previewAssets: [],
};

describe('GET /api/view/[shareToken]/documents/[documentId]/versions — scan gate', () => {
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

    // The DB "stores" both a CLEAN and an INFECTED version; return only the rows
    // whose scanStatus the query admits.
    mockVersionFindMany.mockImplementation((args: { where?: Record<string, unknown> }) => {
      const all = [INFECTED_VERSION, CLEAN_VERSION];
      const filter = args?.where?.['scanStatus'] as { in?: string[] } | undefined;
      const gated = Array.isArray(filter?.in);
      return Promise.resolve(gated ? all.filter((v) => filter!.in!.includes(v.scanStatus)) : all);
    });

    mockWithOrgContext.mockImplementation(
      async (_orgId: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          document: { findFirst: mockDocFindFirst },
          documentVersion: { findMany: mockVersionFindMany },
        })
    );
  });

  it('excludes the INFECTED version from the listing', async () => {
    const res = await GET(makeRequest(), makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    const ids = body.versions.map((v: { id: string }) => v.id);
    expect(ids).toEqual(['ver-1']);
    expect(ids).not.toContain('ver-2');
  });
});
