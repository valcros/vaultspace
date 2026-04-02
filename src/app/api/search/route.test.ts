/**
 * Search API Tests
 *
 * Validates GET handler for full-text document search.
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

// Mock DB transaction with $queryRaw for raw SQL
const mockTx = {
  $queryRaw: vi.fn(),
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET } from './route';

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // First call: count query
    mockTx.$queryRaw.mockResolvedValueOnce([{ count: BigInt(1) }]);
    // Second call: results query
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
    mockTx.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);

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
    mockTx.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);

    const req = new NextRequest('http://localhost:3000/api/search?q=test');
    await GET(req);

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
  });
});
