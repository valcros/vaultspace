/**
 * Middleware Tests (Issue 2)
 *
 * Validates setup wizard redirect behavior and exemption paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// We need to mock fetch globally since middleware uses it
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { middleware } from './middleware';

function makeRequest(
  path: string,
  host = 'vaultspace.org'
): NextRequest {
  const url = new URL(`http://${host}${path}`);
  const req = new NextRequest(url, {
    headers: { host },
  });
  return req;
}

describe('middleware — setup enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setup redirect fires', () => {
    it('redirects to /setup when setupRequired is true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ setupRequired: true }),
      });
      const res = await middleware(makeRequest('/'));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/setup');
    });

    it('redirects on deep routes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ setupRequired: true }),
      });
      const res = await middleware(makeRequest('/rooms'));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/setup');
    });
  });

  describe('exemptions — no redirect', () => {
    it('does not redirect the setup page itself', async () => {
      const res = await middleware(makeRequest('/setup'));
      // Should not call fetch at all for /setup
      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('does not redirect API routes', async () => {
      const res = await middleware(makeRequest('/api/auth/login'));
      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('does not redirect static/file routes', async () => {
      const res = await middleware(makeRequest('/favicon.ico'));
      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('skips setup check for localhost', async () => {
      const res = await middleware(makeRequest('/', 'localhost:3000'));
      // Localhost short-circuits before the setup check
      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('skips setup check for private network (192.168.x.x)', async () => {
      const res = await middleware(makeRequest('/', '192.168.1.50'));
      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  describe('post-setup — no redirect', () => {
    it('does not redirect when setup is complete', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ setupRequired: false }),
      });
      const res = await middleware(makeRequest('/'));
      expect(res.status).toBe(200);
    });

    it('does not redirect deep routes when setup is complete', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ setupRequired: false }),
      });
      const res = await middleware(makeRequest('/rooms'));
      expect(res.status).toBe(200);
    });
  });

  describe('field name correctness', () => {
    it('does NOT redirect when only needsSetup is true (wrong field name)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ needsSetup: true, setupRequired: false }),
      });
      const res = await middleware(makeRequest('/'));
      // Should NOT redirect because we read setupRequired, not needsSetup
      expect(res.status).toBe(200);
    });
  });
});
