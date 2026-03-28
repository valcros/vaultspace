/**
 * Viewer Link Info API Tests (Issue 3)
 *
 * Validates NDA field propagation and individual gate booleans.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the db module
const mockFindFirst = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    link: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

import { GET } from './route';

function makeContext(shareToken: string) {
  return { params: Promise.resolve({ shareToken }) };
}

const baseLink = {
  id: 'link-1',
  name: 'Test Link',
  slug: 'test-token',
  isActive: true,
  expiresAt: null,
  requiresPassword: false,
  requiresEmailVerification: false,
  room: {
    name: 'Test Room',
    requiresNda: false,
    ndaContent: null,
  },
  organization: {
    name: 'Test Org',
    logoUrl: null,
  },
};

describe('GET /api/view/[shareToken]/info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for invalid/expired link', async () => {
    mockFindFirst.mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/view/bad-token/info');
    const res = await GET(req, makeContext('bad-token'));
    expect(res.status).toBe(404);
  });

  describe('NDA fields (Issue 3a)', () => {
    it('returns ndaRequired: true and ndaText when room has NDA', async () => {
      mockFindFirst.mockResolvedValue({
        ...baseLink,
        room: {
          name: 'NDA Room',
          requiresNda: true,
          ndaContent: 'You must keep this confidential.',
        },
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.link.ndaRequired).toBe(true);
      expect(body.link.ndaText).toBe('You must keep this confidential.');
    });

    it('returns ndaRequired: false when room has no NDA', async () => {
      mockFindFirst.mockResolvedValue(baseLink);
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.ndaRequired).toBe(false);
      expect(body.link.ndaText).toBeNull();
    });
  });

  describe('Gate booleans (Issue 3b)', () => {
    it('returns both requiresPassword and requiresEmail when both are set', async () => {
      mockFindFirst.mockResolvedValue({
        ...baseLink,
        requiresPassword: true,
        requiresEmailVerification: true,
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.requiresPassword).toBe(true);
      expect(body.link.requiresEmail).toBe(true);
    });

    it('returns only requiresPassword when only password is set', async () => {
      mockFindFirst.mockResolvedValue({
        ...baseLink,
        requiresPassword: true,
        requiresEmailVerification: false,
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.requiresPassword).toBe(true);
      expect(body.link.requiresEmail).toBe(false);
    });

    it('returns only requiresEmail when only email is set', async () => {
      mockFindFirst.mockResolvedValue({
        ...baseLink,
        requiresPassword: false,
        requiresEmailVerification: true,
      });
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link.requiresPassword).toBe(false);
      expect(body.link.requiresEmail).toBe(true);
    });

    it('does not return accessType (removed)', async () => {
      mockFindFirst.mockResolvedValue(baseLink);
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      const res = await GET(req, makeContext('test-token'));
      const body = await res.json();

      expect(body.link).not.toHaveProperty('accessType');
    });
  });

  describe('Prisma query correctness', () => {
    it('queries room with requiresNda and ndaContent fields', async () => {
      mockFindFirst.mockResolvedValue(baseLink);
      const req = new NextRequest('http://localhost:3000/api/view/test-token/info');
      await GET(req, makeContext('test-token'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query = mockFindFirst.mock.calls[0]![0] as any;
      expect(query.include.room.select).toEqual(
        expect.objectContaining({
          requiresNda: true,
          ndaContent: true,
        })
      );
    });
  });
});
