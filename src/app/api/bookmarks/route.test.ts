/**
 * Bookmarks API Tests
 *
 * Validates GET (list), POST (create), and DELETE (remove) for bookmarks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const permissionMocks = vi.hoisted(() => ({
  can: vi.fn(),
  getViewableRoomIds: vi.fn(),
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

// Mock DB transaction
const mockTx = {
  bookmark: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  document: { findFirst: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));
vi.mock('@/lib/permissions', () => ({
  getPermissionEngine: () => ({
    can: permissionMocks.can,
    getViewableRoomIds: permissionMocks.getViewableRoomIds,
  }),
}));

import { GET, POST, DELETE } from './route';

describe('GET /api/bookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionMocks.can.mockResolvedValue(true);
    permissionMocks.getViewableRoomIds.mockResolvedValue(null);
  });

  it('returns bookmarks list', async () => {
    const bookmarks = [
      {
        id: 'bm-1',
        documentId: 'doc-1',
        document: {
          id: 'doc-1',
          name: 'NDA.pdf',
          mimeType: 'application/pdf',
          folderId: null,
        },
        room: { id: 'room-1', name: 'Room A' },
      },
      {
        id: 'bm-2',
        documentId: 'doc-2',
        document: {
          id: 'doc-2',
          name: 'Contract.pdf',
          mimeType: 'application/pdf',
          folderId: null,
        },
        room: { id: 'room-1', name: 'Room A' },
      },
    ];
    mockTx.bookmark.findMany.mockResolvedValue(bookmarks);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bookmarks).toHaveLength(2);
  });

  it('filters bookmarks after access is revoked', async () => {
    mockTx.bookmark.findMany.mockResolvedValue([
      {
        id: 'bm-denied',
        documentId: 'doc-denied',
        document: {
          id: 'doc-denied',
          name: 'Restricted.pdf',
          mimeType: 'application/pdf',
          folderId: 'folder-1',
        },
        room: { id: 'room-denied', name: 'Restricted Room' },
      },
    ]);
    permissionMocks.can.mockResolvedValue(false);
    permissionMocks.getViewableRoomIds.mockResolvedValue(new Set());

    const res = await GET();
    const body = await res.json();

    expect(body.bookmarks).toEqual([]);
    expect(permissionMocks.can).toHaveBeenCalledWith(
      { userId: 'user-1' },
      'view',
      {
        type: 'DOCUMENT',
        organizationId: 'org-1',
        roomId: 'room-denied',
        folderId: 'folder-1',
        documentId: 'doc-denied',
      },
      mockTx
    );
  });

  it('returns 401 for unauthenticated', async () => {
    const { requireAuth } = await import('@/lib/middleware');
    (requireAuth as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Authentication required')
    );

    const res = await GET();

    expect(res.status).toBe(401);
  });
});

describe('POST /api/bookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionMocks.can.mockResolvedValue(true);
  });

  it('creates bookmark and returns 201', async () => {
    const created = { id: 'bm-new', userId: 'user-1', documentId: 'doc-1', roomId: 'room-1' };
    mockTx.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      roomId: 'room-1',
      folderId: null,
    });
    mockTx.bookmark.upsert.mockResolvedValue(created);

    const req = new NextRequest('http://localhost:3000/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify({ documentId: 'doc-1', roomId: 'room-1' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.bookmark.id).toBe('bm-new');
  });

  it('does not create a bookmark for an unauthorized document', async () => {
    mockTx.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      roomId: 'room-1',
      folderId: null,
    });
    permissionMocks.can.mockResolvedValue(false);

    const req = new NextRequest('http://localhost:3000/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify({ documentId: 'doc-1', roomId: 'room-1' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
    expect(mockTx.bookmark.upsert).not.toHaveBeenCalled();
  });

  it('returns 400 for missing documentId', async () => {
    const req = new NextRequest('http://localhost:3000/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify({ roomId: 'room-1' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/bookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes bookmark and returns success', async () => {
    mockTx.bookmark.deleteMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest('http://localhost:3000/api/bookmarks', {
      method: 'DELETE',
      body: JSON.stringify({ documentId: 'doc-1' }),
    });
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
