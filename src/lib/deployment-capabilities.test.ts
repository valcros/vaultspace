/**
 * Deployment Capabilities Tests
 *
 * Tests for capability resolution, checking, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Store original env
const originalEnv = process.env;

describe('deployment-capabilities', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Default to standalone mode for most tests
    process.env['DEPLOYMENT_MODE'] = 'standalone';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveCapabilities', () => {
    it('returns all capabilities as true when Redis and services are configured', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      process.env['GOTENBERG_URL'] = 'http://localhost:3000';
      process.env['CLAMAV_HOST'] = 'localhost';
      process.env['SMTP_HOST'] = 'smtp.example.com';

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canQueueJobs).toBe(true);
      expect(caps.canUseDistributedCache).toBe(true);
      expect(caps.canGenerateAsyncPreviews).toBe(true);
      expect(caps.canRunVirusScanning).toBe(true);
      expect(caps.canSendAsyncEmail).toBe(true);
      expect(caps.canSendSyncEmail).toBe(true);
    });

    it('returns job capabilities as false without Redis', async () => {
      delete process.env['REDIS_URL'];

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canQueueJobs).toBe(false);
      expect(caps.canUseDistributedCache).toBe(false);
      expect(caps.canGenerateAsyncPreviews).toBe(false);
      expect(caps.canSendAsyncEmail).toBe(false);
      expect(caps.canRunScheduledReports).toBe(false);
      expect(caps.canRunBulkExport).toBe(false);
    });

    it('returns virus scanning as false without ClamAV or passthrough', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      delete process.env['CLAMAV_HOST'];
      delete process.env['SCAN_ENGINE'];

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canRunVirusScanning).toBe(false);
    });

    it('returns sync previews as always true (Sharp is bundled)', async () => {
      delete process.env['REDIS_URL'];
      delete process.env['GOTENBERG_URL'];

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canGenerateSyncPreviews).toBe(true);
    });

    it('returns sync email as true when SMTP configured', async () => {
      delete process.env['REDIS_URL'];
      process.env['SMTP_HOST'] = 'smtp.example.com';

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canSendSyncEmail).toBe(true);
      expect(caps.canSendAsyncEmail).toBe(false); // No Redis
    });

    it('returns sync email as true when ACS configured (no SMTP)', async () => {
      delete process.env['REDIS_URL'];
      delete process.env['SMTP_HOST'];
      delete process.env['SMTP_URL'];
      process.env['EMAIL_PROVIDER'] = 'acs';
      process.env['ACS_CONNECTION_STRING'] =
        'endpoint=https://example.communication.azure.com/;accesskey=fake';

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canSendSyncEmail).toBe(true);
      expect(caps.canSendAsyncEmail).toBe(false);
    });

    it('returns async email as true when ACS configured with Redis', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      delete process.env['SMTP_HOST'];
      delete process.env['SMTP_URL'];
      process.env['EMAIL_PROVIDER'] = 'acs';
      process.env['ACS_CONNECTION_STRING'] =
        'endpoint=https://example.communication.azure.com/;accesskey=fake';

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canSendAsyncEmail).toBe(true);
    });

    it('does not treat EMAIL_PROVIDER=acs without connection string as configured', async () => {
      delete process.env['SMTP_HOST'];
      delete process.env['SMTP_URL'];
      process.env['EMAIL_PROVIDER'] = 'acs';
      delete process.env['ACS_CONNECTION_STRING'];

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canSendSyncEmail).toBe(false);
    });

    it('treats SCAN_ENGINE=passthrough as a configured scanning capability', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      delete process.env['CLAMAV_HOST'];
      process.env['SCAN_ENGINE'] = 'passthrough';

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canRunVirusScanning).toBe(true);
    });

    it('still requires Redis for canRunVirusScanning even with passthrough', async () => {
      delete process.env['REDIS_URL'];
      delete process.env['CLAMAV_HOST'];
      process.env['SCAN_ENGINE'] = 'passthrough';

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canRunVirusScanning).toBe(false);
    });

    it('returns thumbnails capability based on Redis + preview provider', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      process.env['GOTENBERG_URL'] = 'http://localhost:3000';

      const { resolveCapabilities } = await import('./deployment-capabilities');
      const caps = resolveCapabilities();

      expect(caps.canGenerateThumbnails).toBe(true);
    });
  });

  describe('hasCapability', () => {
    it('returns true for available capability', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';

      const { hasCapability } = await import('./deployment-capabilities');
      expect(hasCapability('canQueueJobs')).toBe(true);
    });

    it('returns false for unavailable capability', async () => {
      delete process.env['REDIS_URL'];

      const { hasCapability } = await import('./deployment-capabilities');
      expect(hasCapability('canQueueJobs')).toBe(false);
    });
  });

  describe('requireCapability', () => {
    it('does not throw when capability is available', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';

      const { requireCapability } = await import('./deployment-capabilities');
      expect(() => requireCapability('canQueueJobs')).not.toThrow();
    });

    it('throws CapabilityUnavailableError when capability is unavailable', async () => {
      delete process.env['REDIS_URL'];

      const { requireCapability, CapabilityUnavailableError } =
        await import('./deployment-capabilities');

      expect(() => requireCapability('canQueueJobs')).toThrow(CapabilityUnavailableError);
    });

    it('includes capability name in error message', async () => {
      delete process.env['REDIS_URL'];

      const { requireCapability } = await import('./deployment-capabilities');

      try {
        requireCapability('canQueueJobs');
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('canQueueJobs');
      }
    });
  });

  describe('CapabilityUnavailableError', () => {
    it('has correct name property', async () => {
      const { CapabilityUnavailableError } = await import('./deployment-capabilities');
      const error = new CapabilityUnavailableError('canQueueJobs');
      expect(error.name).toBe('CapabilityUnavailableError');
    });

    it('stores capability name', async () => {
      const { CapabilityUnavailableError } = await import('./deployment-capabilities');
      const error = new CapabilityUnavailableError('canRunVirusScanning');
      expect(error.capability).toBe('canRunVirusScanning');
    });

    it('is instanceof Error', async () => {
      const { CapabilityUnavailableError } = await import('./deployment-capabilities');
      const error = new CapabilityUnavailableError('canQueueJobs');
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('getDegradedCapabilities', () => {
    it('returns empty array when all capabilities available', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      process.env['GOTENBERG_URL'] = 'http://localhost:3000';
      process.env['CLAMAV_HOST'] = 'localhost';
      process.env['SMTP_HOST'] = 'smtp.example.com';

      const { getDegradedCapabilities } = await import('./deployment-capabilities');
      const degraded = getDegradedCapabilities();

      expect(degraded).toEqual([]);
    });

    it('returns degraded capabilities when services missing', async () => {
      delete process.env['REDIS_URL'];
      delete process.env['CLAMAV_HOST'];

      const { getDegradedCapabilities } = await import('./deployment-capabilities');
      const degraded = getDegradedCapabilities();

      expect(degraded).toContain('canQueueJobs');
      expect(degraded).toContain('canRunVirusScanning');
      expect(degraded).toContain('canGenerateAsyncPreviews');
    });

    it('does not include sync capabilities that are always available', async () => {
      delete process.env['REDIS_URL'];

      const { getDegradedCapabilities } = await import('./deployment-capabilities');
      const degraded = getDegradedCapabilities();

      expect(degraded).not.toContain('canGenerateSyncPreviews');
    });
  });

  describe('createCapabilityUnavailableResponse', () => {
    it('returns Response with 503 status', async () => {
      const { createCapabilityUnavailableResponse } = await import('./deployment-capabilities');
      const response = createCapabilityUnavailableResponse('canQueueJobs', 'Export');

      expect(response.status).toBe(503);
    });

    it('includes feature name in message', async () => {
      const { createCapabilityUnavailableResponse } = await import('./deployment-capabilities');
      const response = createCapabilityUnavailableResponse('canQueueJobs', 'Export');

      const body = await response.json();
      expect(body.message).toContain('Export');
    });

    it('includes capability in body', async () => {
      const { createCapabilityUnavailableResponse } = await import('./deployment-capabilities');
      const response = createCapabilityUnavailableResponse('canRunVirusScanning', 'Scan');

      const body = await response.json();
      expect(body.capability).toBe('canRunVirusScanning');
    });

    it('includes reason when service not configured', async () => {
      delete process.env['REDIS_URL'];
      const { createCapabilityUnavailableResponse } = await import('./deployment-capabilities');
      const response = createCapabilityUnavailableResponse('canQueueJobs', 'Test');

      const body = await response.json();
      expect(body.reason).toContain('Redis');
    });

    it('includes Retry-After header', async () => {
      const { createCapabilityUnavailableResponse } = await import('./deployment-capabilities');
      const response = createCapabilityUnavailableResponse('canQueueJobs', 'Test');

      expect(response.headers.get('Retry-After')).toBe('3600');
    });
  });
});

describe('deployment-capabilities in Azure mode', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env['DEPLOYMENT_MODE'] = 'azure';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('enables job queue when Redis configured', async () => {
    process.env['REDIS_URL'] = 'rediss://azure.redis.cache.windows.net:6380';

    const { resolveCapabilities } = await import('./deployment-capabilities');
    const caps = resolveCapabilities();

    expect(caps.canQueueJobs).toBe(true);
  });

  it('enables async previews when Redis and Gotenberg configured', async () => {
    process.env['REDIS_URL'] = 'rediss://azure.redis.cache.windows.net:6380';
    process.env['GOTENBERG_URL'] = 'http://gotenberg:3000';

    const { resolveCapabilities } = await import('./deployment-capabilities');
    const caps = resolveCapabilities();

    expect(caps.canGenerateAsyncPreviews).toBe(true);
  });

  it('disables async previews without Gotenberg even with Redis', async () => {
    process.env['REDIS_URL'] = 'rediss://azure.redis.cache.windows.net:6380';
    delete process.env['GOTENBERG_URL'];

    const { resolveCapabilities } = await import('./deployment-capabilities');
    const caps = resolveCapabilities();

    expect(caps.canQueueJobs).toBe(true);
    expect(caps.canGenerateAsyncPreviews).toBe(false);
  });
});
