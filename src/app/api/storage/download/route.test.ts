/**
 * Storage Download API Tests (Issue 1)
 *
 * Validates that the download route rejects non-local providers with 404,
 * validates signatures unconditionally for local storage, and serves files correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the providers module
const mockGetProviders = vi.fn();
vi.mock('@/providers', () => ({
  getProviders: () => mockGetProviders(),
}));

// We need the real class for instanceof checks
vi.mock('@/providers/storage/LocalStorageProvider', () => {
  class LocalStorageProvider {
    validateSignedUrl = vi.fn();
    exists = vi.fn();
    get = vi.fn();
  }
  return { LocalStorageProvider };
});

import { GET } from './route';
import { LocalStorageProvider } from '@/providers/storage/LocalStorageProvider';

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/storage/download');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe('GET /api/storage/download', () => {
  let localProvider: LocalStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    localProvider = new (LocalStorageProvider as unknown as new () => LocalStorageProvider)();
    mockGetProviders.mockReturnValue({ storage: localProvider });
  });

  describe('Non-local provider (Azure/S3)', () => {
    it('returns 404 for non-local provider regardless of params', async () => {
      mockGetProviders.mockReturnValue({ storage: {} }); // Not a LocalStorageProvider instance
      const res = await GET(makeRequest({ bucket: 'b', key: 'k', expires: '999', sig: 'abc' }));
      expect(res.status).toBe(404);
    });

    it('returns 404 for non-local provider even without params', async () => {
      mockGetProviders.mockReturnValue({ storage: {} });
      const res = await GET(makeRequest());
      expect(res.status).toBe(404);
    });
  });

  describe('Local provider — param validation', () => {
    it('returns 400 when params are missing', async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/Missing required parameters/);
    });

    it('returns 400 when sig is missing', async () => {
      const res = await GET(makeRequest({ bucket: 'b', key: 'k', expires: '999' }));
      expect(res.status).toBe(400);
    });
  });

  describe('Local provider — signature validation', () => {
    const validParams = { bucket: 'test-bucket', key: 'docs/file.pdf', expires: '9999999999', sig: 'validsig' };

    it('returns 403 for invalid signature', async () => {
      (localProvider.validateSignedUrl as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await GET(makeRequest(validParams));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/Invalid or expired/);
    });

    it('returns 403 for expired URL', async () => {
      (localProvider.validateSignedUrl as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await GET(makeRequest({ ...validParams, expires: '1000000000' }));
      expect(res.status).toBe(403);
    });

    it('returns 404 when file does not exist', async () => {
      (localProvider.validateSignedUrl as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (localProvider.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const res = await GET(makeRequest(validParams));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });

    it('returns 200 with file content for valid request', async () => {
      const fileData = Buffer.from('hello world');
      (localProvider.validateSignedUrl as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (localProvider.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (localProvider.get as ReturnType<typeof vi.fn>).mockResolvedValue(fileData);

      const res = await GET(makeRequest(validParams));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toContain('file.pdf');
    });
  });
});
