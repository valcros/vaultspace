/**
 * Search API Tests
 *
 * Validates GET handler for full-text document search.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const permissionMocks = vi.hoisted(() => ({
  getViewableRoomIds: vi.fn(),
  can: vi.fn(),
}));

// Mock auth
const mockSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
  user: { email: 'admin@example.com' },
};
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(() => Promise.resolve(mockSession)),
}));

// Mock DB transaction with $queryRaw for raw SQL
const mockTx = {
  $queryRaw: vi.fn(),
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));
vi.mock('@/lib/permissions', () => ({
  getPermissionEngine: () => ({
    getViewableRoomIds: permissionMocks.getViewableRoomIds,
    can: permissionMocks.can,
  }),
}));

import { GET } from './route';

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionMocks.getViewableRoomIds.mockResolvedValue(null);
    permissionMocks.can.mockResolvedValue(true);
  });

  it('returns 400 when no query param', async () => {
    const req = new NextRequest('http://localhost:3000/api/search');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when query param is empty', async () => {
    const req = new NextRequest('http://localhost:3000/api/search?q=');
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it('returns search results with correct shape', async () => {
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        documentId: 'doc-1',
        versionId: 'ver-1',
        title: 'Test Document',
        fileName: 'test.pdf',
        snippet: 'matching <b>content</b> here',
        score: 0.85,
        mimeType: 'application/pdf',
        tags: ['legal'],
        uploadedAt: new Date('2026-01-01'),
        roomId: 'room-1',
        folderId: null,
        roomName: 'Test Room',
      },
    ]);

    const req = new NextRequest('http://localhost:3000/api/search?q=test');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].documentId).toBe('doc-1');
    expect(body.total).toBe(1);
    expect(typeof body.took).toBe('number');
  });

  it('returns empty results for no matches', async () => {
    mockTx.$queryRaw.mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/search?q=nonexistent');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.results).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('scopes search by organizationId via withOrgContext', async () => {
    const { withOrgContext } = await import('@/lib/db');
    mockTx.$queryRaw.mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/search?q=test');
    await GET(req);

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
  });

  it('does not query search data when the viewer has no discoverable room', async () => {
    permissionMocks.getViewableRoomIds.mockResolvedValue(new Set());

    const res = await GET(new NextRequest('http://localhost:3000/api/search?q=restricted'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toEqual([]);
    expect(body.total).toBe(0);
    expect(mockTx.$queryRaw).not.toHaveBeenCalled();
  });

  it('denies an explicitly requested room outside the viewer room set', async () => {
    permissionMocks.getViewableRoomIds.mockResolvedValue(new Set(['room-allowed']));

    const res = await GET(
      new NextRequest('http://localhost:3000/api/search?q=restricted&roomId=room-denied')
    );

    expect(res.status).toBe(200);
    expect(mockTx.$queryRaw).not.toHaveBeenCalled();
  });

  it('authorizes documents before computing search totals and pagination', async () => {
    permissionMocks.getViewableRoomIds.mockResolvedValue(new Set(['room-allowed']));
    permissionMocks.can.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        documentId: 'doc-denied',
        versionId: 'ver-denied',
        title: 'Denied Document',
        fileName: 'denied.pdf',
        snippet: 'denied match',
        score: 0.9,
        mimeType: 'application/pdf',
        tags: [],
        uploadedAt: new Date('2026-01-01'),
        roomId: 'room-allowed',
        folderId: 'folder-denied',
        roomName: 'Allowed Room',
      },
      {
        documentId: 'doc-allowed',
        versionId: 'ver-allowed',
        title: 'Allowed Document',
        fileName: 'allowed.pdf',
        snippet: 'allowed match',
        score: 0.8,
        mimeType: 'application/pdf',
        tags: [],
        uploadedAt: new Date('2026-01-02'),
        roomId: 'room-allowed',
        folderId: null,
        roomName: 'Allowed Room',
      },
    ]);

    const res = await GET(new NextRequest('http://localhost:3000/api/search?q=match&limit=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.results).toEqual([expect.objectContaining({ documentId: 'doc-allowed' })]);
    expect(permissionMocks.can).toHaveBeenNthCalledWith(
      1,
      { userId: 'user-1' },
      'view',
      {
        type: 'DOCUMENT',
        organizationId: 'org-1',
        roomId: 'room-allowed',
        folderId: 'folder-denied',
        documentId: 'doc-denied',
      },
      mockTx
    );
  });
});
