/**
 * Bookmarks API Tests
 *
 * Validates GET (list), POST (create), and DELETE (remove) for bookmarks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET, POST, DELETE } from './route';

describe('GET /api/bookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns bookmarks list', async () => {
    const bookmarks = [
      {
        id: 'bm-1',
        documentId: 'doc-1',
        document: { id: 'doc-1', name: 'NDA.pdf', mimeType: 'application/pdf' },
        room: { id: 'room-1', name: 'Room A' },
      },
      {
        id: 'bm-2',
        documentId: 'doc-2',
        document: { id: 'doc-2', name: 'Contract.pdf', mimeType: 'application/pdf' },
        room: { id: 'room-1', name: 'Room A' },
      },
    ];
    mockTx.bookmark.findMany.mockResolvedValue(bookmarks);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bookmarks).toHaveLength(2);
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
  });

  it('creates bookmark and returns 201', async () => {
    const created = { id: 'bm-new', userId: 'user-1', documentId: 'doc-1', roomId: 'room-1' };
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
