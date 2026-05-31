/**
 * LocalStorageProvider Unit Tests
 *
 * Covers signed URL generation and validation logic.
 * SEC-015: Signed URLs must expire and reject tampered signatures.
 *
 * No filesystem I/O in these tests — only the HMAC/timestamp logic is exercised.
 */

import { describe, expect, it } from 'vitest';

import { SIGNED_URL_CONFIG } from '@/lib/constants';

import { LocalStorageProvider } from './LocalStorageProvider';

const SECRET = 'test-secret-for-signed-url-validation';

function makeProvider(): LocalStorageProvider {
  return new LocalStorageProvider({ basePath: '/tmp/test', signedUrlSecret: SECRET });
}

/**
 * Parse a signed URL back into its query params.
 */
function parseSignedUrl(url: string): {
  bucket: string;
  key: string;
  expires: string;
  sig: string;
} {
  const qs = new URLSearchParams(url.replace(/^[^?]+\?/, ''));
  return {
    bucket: qs.get('bucket')!,
    key: qs.get('key')!,
    expires: qs.get('expires')!,
    sig: qs.get('sig')!,
  };
}

describe('LocalStorageProvider — signed URL', () => {
  describe('getSignedUrl', () => {
    it('uses PREVIEW_EXPIRY_SECONDS (300) as the default expiry', async () => {
      const provider = makeProvider();
      const before = Math.floor(Date.now() / 1000);
      const url = await provider.getSignedUrl('docs', 'file.pdf');
      const after = Math.floor(Date.now() / 1000);

      const { expires } = parseSignedUrl(url);
      const expiresAt = parseInt(expires, 10);

      expect(SIGNED_URL_CONFIG.PREVIEW_EXPIRY_SECONDS).toBe(300);
      expect(expiresAt).toBeGreaterThanOrEqual(before + 300);
      expect(expiresAt).toBeLessThanOrEqual(after + 300);
    });

    it('generates a URL with the correct path prefix', async () => {
      const provider = makeProvider();
      const url = await provider.getSignedUrl('docs', 'subdir/file.pdf');
      expect(url).toMatch(/^\/api\/storage\/download\?/);
    });

    it('generates a URL that validates successfully when not expired', async () => {
      const provider = makeProvider();
      const url = await provider.getSignedUrl('docs', 'file.pdf', 300);
      const { bucket, key, expires, sig } = parseSignedUrl(url);

      expect(provider.validateSignedUrl(bucket, key, expires, sig)).toBe(true);
    });
  });

  // SEC-015: Signed URL expiry enforcement
  describe('SEC-015: validateSignedUrl rejects expired URLs', () => {
    it('rejects a URL whose expires timestamp is in the past', async () => {
      const provider = makeProvider();
      // Generate with negative expiry so the timestamp is already past
      const url = await provider.getSignedUrl('docs', 'file.pdf', -300);
      const { bucket, key, expires, sig } = parseSignedUrl(url);

      expect(provider.validateSignedUrl(bucket, key, expires, sig)).toBe(false);
    });

    it('rejects when expires is exactly at the current second (now > expiresAt boundary)', async () => {
      const provider = makeProvider();
      // Build a legitimately-signed payload with expiresAt = now - 1 to isolate expiry check
      const url = await provider.getSignedUrl('docs', 'file.pdf', -1);
      const { bucket, key, expires, sig } = parseSignedUrl(url);

      // The URL was signed with expiresAt = now - 1; validation must reject it
      expect(parseInt(expires, 10)).toBeLessThan(Math.floor(Date.now() / 1000) + 1);
      expect(provider.validateSignedUrl(bucket, key, expires, sig)).toBe(false);
    });

    it('rejects a URL with a tampered signature even if not expired', async () => {
      const provider = makeProvider();
      const url = await provider.getSignedUrl('docs', 'file.pdf', 300);
      const { bucket, key, expires } = parseSignedUrl(url);

      expect(provider.validateSignedUrl(bucket, key, expires, 'bad-signature')).toBe(false);
    });

    it('rejects a URL with a tampered key even if signature was originally valid', async () => {
      const provider = makeProvider();
      const url = await provider.getSignedUrl('docs', 'original.pdf', 300);
      const { bucket, expires, sig } = parseSignedUrl(url);

      // Swap key; signature no longer matches
      expect(provider.validateSignedUrl(bucket, 'different.pdf', expires, sig)).toBe(false);
    });

    it('accepts a correctly signed non-expired URL', async () => {
      const provider = makeProvider();
      const url = await provider.getSignedUrl('bucket', 'path/to/doc.pdf', 60);
      const { bucket, key, expires, sig } = parseSignedUrl(url);

      expect(provider.validateSignedUrl(bucket, key, expires, sig)).toBe(true);
    });
  });
});
