/**
 * Azure Guard Tests
 *
 * Tests for deployment mode enforcement and configuration validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Store original env
const originalEnv = process.env;

describe('azure-guard', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isLocalhost', () => {
    it('returns true for localhost URLs', async () => {
      const { isLocalhost } = await import('./azure-guard');

      expect(isLocalhost('postgresql://localhost:5432/db')).toBe(true);
      expect(isLocalhost('postgresql://localhost/db')).toBe(true);
      expect(isLocalhost('redis://localhost:6379')).toBe(true);
    });

    it('returns true for 127.0.0.1 URLs', async () => {
      const { isLocalhost } = await import('./azure-guard');

      expect(isLocalhost('postgresql://127.0.0.1:5432/db')).toBe(true);
      expect(isLocalhost('redis://127.0.0.1:6379')).toBe(true);
    });

    it('returns true for host.docker.internal URLs', async () => {
      const { isLocalhost } = await import('./azure-guard');

      expect(isLocalhost('postgresql://host.docker.internal:5432/db')).toBe(true);
    });

    it('returns true for 0.0.0.0 URLs', async () => {
      const { isLocalhost } = await import('./azure-guard');

      expect(isLocalhost('redis://0.0.0.0:6379')).toBe(true);
    });

    it('returns false for remote URLs', async () => {
      const { isLocalhost } = await import('./azure-guard');

      expect(isLocalhost('postgresql://db.example.com:5432/db')).toBe(false);
      expect(isLocalhost('redis://cache.redis.azure.com:6380')).toBe(false);
      expect(isLocalhost('postgresql://10.0.0.5:5432/db')).toBe(false);
    });

    it('returns false for undefined/null', async () => {
      const { isLocalhost } = await import('./azure-guard');

      expect(isLocalhost(undefined)).toBe(false);
      expect(isLocalhost('')).toBe(false);
    });
  });

  describe('validateConfig', () => {
    describe('in Azure mode', () => {
      beforeEach(() => {
        process.env['DEPLOYMENT_MODE'] = 'azure';
      });

      it('returns errors when Azure storage not configured', async () => {
        process.env['DATABASE_URL'] = 'postgresql://azure.postgres.database.azure.com/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['REDIS_URL'] = 'rediss://azure.redis.cache.windows.net:6380';
        delete process.env['AZURE_STORAGE_ACCOUNT_NAME'];
        delete process.env['AZURE_STORAGE_ACCOUNT_KEY'];

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((e) => e.includes('storage') || e.includes('AZURE'))).toBe(true);
      });

      it('returns errors when using localhost database', async () => {
        process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['REDIS_URL'] = 'rediss://azure.redis.cache.windows.net:6380';
        process.env['AZURE_STORAGE_ACCOUNT_NAME'] = 'test';
        process.env['AZURE_STORAGE_ACCOUNT_KEY'] = 'key';

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((e) => e.includes('localhost') || e.includes('Azure'))).toBe(true);
      });

      it('returns no errors with valid Azure config', async () => {
        process.env['DATABASE_URL'] = 'postgresql://azure.postgres.database.azure.com/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['REDIS_URL'] = 'rediss://azure.redis.cache.windows.net:6380';
        process.env['AZURE_STORAGE_ACCOUNT_NAME'] = 'teststorage';
        process.env['AZURE_STORAGE_ACCOUNT_KEY'] = 'base64key==';

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        expect(errors).toEqual([]);
      });

      it('accepts Azure storage connection string format', async () => {
        process.env['DATABASE_URL'] = 'postgresql://azure.postgres.database.azure.com/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['REDIS_URL'] = 'rediss://azure.redis.cache.windows.net:6380';
        process.env['AZURE_STORAGE_CONNECTION_STRING'] =
          'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key==;EndpointSuffix=core.windows.net';

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        // Should accept connection string as valid config
        expect(errors.filter((e) => e.toLowerCase().includes('storage'))).toEqual([]);
      });
      it('requires SESSION_SECRET', async () => {
        process.env['DATABASE_URL'] = 'postgresql://azure.postgres.database.azure.com/db';
        process.env['REDIS_URL'] = 'rediss://azure.redis.cache.windows.net:6380';
        process.env['AZURE_STORAGE_ACCOUNT_NAME'] = 'teststorage';
        process.env['AZURE_STORAGE_ACCOUNT_KEY'] = 'base64key==';
        delete process.env['SESSION_SECRET'];

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        expect(errors).toContain('SESSION_SECRET is not set');
      });
    });

    describe('in Standalone mode', () => {
      beforeEach(() => {
        process.env['DEPLOYMENT_MODE'] = 'standalone';
      });

      it('allows localhost database', async () => {
        process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['STORAGE_PROVIDER'] = 'local';
        process.env['STORAGE_LOCAL_PATH'] = './storage';

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        expect(errors.filter((e) => e.includes('localhost'))).toEqual([]);
      });

      it('allows local storage provider', async () => {
        process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['STORAGE_PROVIDER'] = 'local';
        process.env['STORAGE_LOCAL_PATH'] = './storage';

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        expect(errors).toEqual([]);
      });

      it('allows S3-compatible storage', async () => {
        process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['S3_ENDPOINT'] = 'http://minio:9000';

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        expect(errors).toEqual([]);
      });

      it('does not require Redis', async () => {
        process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['STORAGE_PROVIDER'] = 'local';
        process.env['STORAGE_LOCAL_PATH'] = './storage';
        delete process.env['REDIS_URL'];

        const { validateConfig } = await import('./azure-guard');
        const { errors, warnings } = validateConfig();

        expect(errors).toEqual([]);
        // Should have a warning about Redis though
        expect(warnings.some((w) => w.includes('Redis') || w.includes('async'))).toBe(true);
      });

      it('returns warnings for missing optional services', async () => {
        process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['STORAGE_PROVIDER'] = 'local';
        process.env['STORAGE_LOCAL_PATH'] = './storage';
        delete process.env['REDIS_URL'];
        delete process.env['CLAMAV_HOST'];

        const { validateConfig } = await import('./azure-guard');
        const { warnings } = validateConfig();

        expect(warnings.length).toBeGreaterThan(0);
      });

      it('warns about local storage limitations', async () => {
        process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';
        process.env['SESSION_SECRET'] = 'test-session-secret';
        process.env['STORAGE_PROVIDER'] = 'local';
        process.env['STORAGE_LOCAL_PATH'] = './storage';

        const { validateConfig } = await import('./azure-guard');
        const { warnings } = validateConfig();

        expect(
          warnings.some((w) => w.includes('Local filesystem') || w.includes('single-node'))
        ).toBe(true);
      });

      it('requires SESSION_SECRET', async () => {
        process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';
        process.env['STORAGE_PROVIDER'] = 'local';
        process.env['STORAGE_LOCAL_PATH'] = './storage';
        delete process.env['SESSION_SECRET'];

        const { validateConfig } = await import('./azure-guard');
        const { errors } = validateConfig();

        expect(errors).toContain('SESSION_SECRET is not set');
      });
    });
  });

  describe('guardIntegrationTests', () => {
    it('allows localhost in standalone mode', async () => {
      process.env['DEPLOYMENT_MODE'] = 'standalone';
      process.env['DATABASE_URL'] = 'postgresql://localhost:5432/test';

      const { guardIntegrationTests } = await import('./azure-guard');

      // Should not throw
      expect(() => guardIntegrationTests()).not.toThrow();
    });

    it('blocks localhost in azure mode', async () => {
      process.env['DEPLOYMENT_MODE'] = 'azure';
      process.env['DATABASE_URL'] = 'postgresql://localhost:5432/test';

      const { guardIntegrationTests } = await import('./azure-guard');

      expect(() => guardIntegrationTests()).toThrow();
    });

    it('allows Azure URLs in azure mode', async () => {
      process.env['DEPLOYMENT_MODE'] = 'azure';
      process.env['DATABASE_URL'] = 'postgresql://server.postgres.database.azure.com/test';

      const { guardIntegrationTests } = await import('./azure-guard');

      // Should not throw
      expect(() => guardIntegrationTests()).not.toThrow();
    });
  });

  describe('enforceDeploymentMode', () => {
    it('does not exit in standalone mode', async () => {
      process.env['DEPLOYMENT_MODE'] = 'standalone';
      process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const mockConsole = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { enforceDeploymentMode } = await import('./azure-guard');
      enforceDeploymentMode();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockConsole).toHaveBeenCalledWith(expect.stringContaining('standalone'));

      mockExit.mockRestore();
      mockConsole.mockRestore();
    });

    it('logs Azure mode when running with Azure config', async () => {
      process.env['DEPLOYMENT_MODE'] = 'azure';
      process.env['DATABASE_URL'] = 'postgresql://server.postgres.database.azure.com/db';
      process.env['WEBSITE_SITE_NAME'] = 'my-azure-app'; // Azure indicator

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const mockConsole = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { enforceDeploymentMode } = await import('./azure-guard');
      enforceDeploymentMode();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockConsole).toHaveBeenCalledWith(expect.stringContaining('Azure mode'));

      mockExit.mockRestore();
      mockConsole.mockRestore();
    });
  });

  describe('enforceAzureOnly (deprecated alias)', () => {
    it('calls enforceDeploymentMode', async () => {
      process.env['DEPLOYMENT_MODE'] = 'standalone';
      process.env['DATABASE_URL'] = 'postgresql://localhost:5432/db';

      const mockConsole = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { enforceAzureOnly } = await import('./azure-guard');
      enforceAzureOnly();

      // Should log the same as enforceDeploymentMode
      expect(mockConsole).toHaveBeenCalledWith(expect.stringContaining('standalone'));

      mockConsole.mockRestore();
    });
  });
});
