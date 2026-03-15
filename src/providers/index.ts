/**
 * Provider Factory
 *
 * Creates provider instances based on environment configuration.
 * All providers are singletons within the application lifecycle.
 */

import type { CacheProvider, EmailProvider, JobProvider, Providers, StorageProvider } from './types';

import { InMemoryCacheProvider } from './cache/InMemoryCacheProvider';
import { RedisCacheProvider } from './cache/RedisCacheProvider';
import { ConsoleEmailProvider } from './email/ConsoleEmailProvider';
import { SmtpEmailProvider } from './email/SmtpEmailProvider';
import { BullMQJobProvider } from './job/BullMQJobProvider';
import { LocalStorageProvider } from './storage/LocalStorageProvider';

// Singleton instance
let providersInstance: Providers | null = null;

/**
 * Get or create the providers singleton
 */
export function getProviders(): Providers {
  if (!providersInstance) {
    providersInstance = createProviders();
  }
  return providersInstance;
}

/**
 * Create providers based on environment configuration
 */
function createProviders(): Providers {
  return {
    storage: createStorageProvider(),
    email: createEmailProvider(),
    cache: createCacheProvider(),
    job: createJobProvider(),
    scan: createScanProvider(),
    preview: createPreviewProvider(),
    search: createSearchProvider(),
    encryption: createEncryptionProvider(),
  };
}

function createStorageProvider(): StorageProvider {
  const provider = process.env['STORAGE_PROVIDER'] ?? 'local';

  switch (provider) {
    case 'local': {
      return new LocalStorageProvider({
        basePath: process.env['STORAGE_LOCAL_PATH'] ?? './storage',
        signedUrlSecret: process.env['SESSION_SECRET'] ?? 'dev-secret',
      });
    }
    // S3 and Azure providers would be added here for production
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}

function createEmailProvider(): EmailProvider {
  const provider = process.env['EMAIL_PROVIDER'] ?? 'console';
  const isDev = process.env['NODE_ENV'] !== 'production';

  // Always use console in dev if no SMTP configured
  if (isDev && !process.env['SMTP_HOST']) {
    return new ConsoleEmailProvider();
  }

  switch (provider) {
    case 'smtp': {
      return new SmtpEmailProvider({
        host: process.env['SMTP_HOST'] ?? 'localhost',
        port: parseInt(process.env['SMTP_PORT'] ?? '587', 10),
        secure: process.env['SMTP_TLS'] === 'true',
        user: process.env['SMTP_USER'],
        password: process.env['SMTP_PASSWORD'],
        from: process.env['SMTP_FROM'] ?? 'noreply@vaultspace.local',
      });
    }
    case 'console':
    default: {
      return new ConsoleEmailProvider();
    }
  }
}

function createCacheProvider(): CacheProvider {
  const redisUrl = process.env['REDIS_URL'];

  if (redisUrl) {
    return new RedisCacheProvider({
      url: redisUrl,
      prefix: process.env['JOB_QUEUE_PREFIX'] ?? 'vaultspace:',
      tls: process.env['REDIS_TLS'] === 'true',
    });
  }

  // Fallback to in-memory for development
  return new InMemoryCacheProvider();
}

function createJobProvider(): JobProvider {
  const redisUrl = process.env['REDIS_URL'];

  if (redisUrl) {
    return new BullMQJobProvider({
      redisUrl,
      prefix: process.env['JOB_QUEUE_PREFIX'] ?? 'vaultspace:jobs:',
    });
  }

  // Fallback stub for development without Redis
  return {
    addJob: async () => `job-${Date.now()}`,
    getJobStatus: async () => 'pending',
    cancelJob: async () => {},
  };
}

// Stub implementations for providers that will be fully implemented in later phases

function createScanProvider() {
  return {
    scan: async () => ({ clean: true }),
    isAvailable: async () => false,
  };
}

function createPreviewProvider() {
  return {
    convert: async () => ({ pages: [], totalPages: 0, mimeType: 'application/pdf' }),
    generateThumbnail: async () => Buffer.alloc(0),
    isSupported: () => false,
  };
}

function createSearchProvider() {
  return {
    search: async () => ({ results: [], total: 0, took: 0 }),
    index: async () => {},
    remove: async () => {},
  };
}

function createEncryptionProvider() {
  return {
    encrypt: async (data: Buffer) => ({
      ciphertext: data,
      iv: Buffer.alloc(16),
      algorithm: 'noop',
    }),
    decrypt: async (encrypted: { ciphertext: Buffer }) => encrypted.ciphertext,
    generateKey: async () => ({
      keyId: 'noop',
      key: Buffer.alloc(32),
    }),
  };
}

// Re-export types
export * from './types';
