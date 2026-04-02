/**
 * Document Page Analytics API Tests
 *
 * Validates GET for per-page view analytics (F026).
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
  document: { findFirst: vi.fn() },
  pageView: { findMany: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET } from './route';

const mockDocument = { id: 'doc-1', name: 'Financial Report.pdf' };

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1' }) };
}

describe('GET /api/rooms/:roomId/documents/:documentId/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.document.findFirst.mockResolvedValue(mockDocument);
  });

  it('returns page view analytics with correct shape', async () => {
    const pageViews = [
      { pageNumber: 1, timeSpentMs: 5000, viewerEmail: 'alice@example.com' },
      { pageNumber: 1, timeSpentMs: 3000, viewerEmail: 'bob@example.com' },
      { pageNumber: 2, timeSpentMs: 2000, viewerEmail: 'alice@example.com' },
    ];
    mockTx.pageView.findMany.mockResolvedValue(pageViews);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/documents/doc-1/analytics');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.document).toEqual({ id: 'doc-1', name: 'Financial Report.pdf' });
    expect(body.pages).toHaveLength(2);
    expect(body.pages[0]).toEqual({
      pageNumber: 1,
      totalViews: 2,
      uniqueViewers: 2,
      avgTimeMs: 4000,
      totalTimeMs: 8000,
    });
    expect(body.summary).toEqual({
      totalPageViews: 3,
      uniquePages: 2,
      totalViewers: 2,
    });
  });

  it('returns empty analytics for document with no views', async () => {
    mockTx.pageView.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/documents/doc-1/analytics');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pages).toHaveLength(0);
    expect(body.summary).toEqual({
      totalPageViews: 0,
      uniquePages: 0,
      totalViewers: 0,
    });
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'MEMBER';

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/documents/doc-1/analytics');
    const res = await GET(req, makeContext());

    expect(res.status).toBe(403);
  });
});
