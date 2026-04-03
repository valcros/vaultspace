/**
 * Provider Factory
 *
 * Creates provider instances based on environment configuration.
 * All providers are singletons within the application lifecycle.
 */

import type {
  CacheProvider,
  EmailProvider,
  JobProvider,
  Providers,
  StorageProvider,
} from './types';

import { InMemoryCacheProvider } from './cache/InMemoryCacheProvider';
import { RedisCacheProvider } from './cache/RedisCacheProvider';
import { AzureCommunicationEmailProvider } from './email/AzureCommunicationEmailProvider';
import { ConsoleEmailProvider } from './email/ConsoleEmailProvider';
import { SmtpEmailProvider } from './email/SmtpEmailProvider';
import { BullMQJobProvider } from './job/BullMQJobProvider';
import { LocalStorageProvider } from './storage/LocalStorageProvider';
import { AzureBlobStorageProvider } from './storage/AzureBlobStorageProvider';
import { S3StorageProvider } from './storage/S3StorageProvider';
import { createOCRProvider } from './ocr';
import { createScanProvider } from './scan';
import { createPreviewProvider } from './preview';
import { isAzureMode } from '../lib/deployment-mode';

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
    ocr: createOCRProvider(),
  };
}

function createStorageProvider(): StorageProvider {
  const provider = process.env['STORAGE_PROVIDER'] ?? 'local';

  switch (provider) {
    case 'local': {
      // Block local storage in Azure mode
      if (isAzureMode()) {
        throw new Error(
          'Local filesystem storage is not permitted in Azure mode. ' +
            'Use STORAGE_PROVIDER=azure for Azure Blob Storage, or ' +
            'set DEPLOYMENT_MODE=standalone for self-hosted operation.'
        );
      }

      console.log(
        '[StorageProvider] Using local filesystem storage. ' +
          'Note: Single-node only, manual backup required, not suitable for HA deployments.'
      );

      return new LocalStorageProvider({
        basePath: process.env['STORAGE_LOCAL_PATH'] ?? './storage',
        signedUrlSecret: process.env['SESSION_SECRET'] ?? 'dev-secret',
      });
    }
    case 'azure': {
      const accountName = process.env['AZURE_STORAGE_ACCOUNT_NAME'];
      const accountKey = process.env['AZURE_STORAGE_ACCOUNT_KEY'];

      if (!accountName || !accountKey) {
        throw new Error(
          'Azure storage requires AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY'
        );
      }

      return new AzureBlobStorageProvider({
        accountName,
        accountKey,
      });
    }
    case 's3': {
      // Support documented VaultSpace vars with AWS SDK vars as fallback
      // Documented: STORAGE_REGION, STORAGE_KEY_ID, STORAGE_SECRET_KEY, STORAGE_BUCKET
      // Fallback: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (standard AWS SDK)
      const region =
        process.env['STORAGE_REGION'] ??
        process.env['AWS_REGION'] ??
        process.env['AWS_DEFAULT_REGION'] ??
        'us-east-1';
      const accessKeyId = process.env['STORAGE_KEY_ID'] ?? process.env['AWS_ACCESS_KEY_ID'];
      const secretAccessKey =
        process.env['STORAGE_SECRET_KEY'] ?? process.env['AWS_SECRET_ACCESS_KEY'];
      const endpoint = process.env['STORAGE_ENDPOINT'] ?? process.env['S3_ENDPOINT'];
      const forcePathStyle = process.env['S3_FORCE_PATH_STYLE'] === 'true';

      // STORAGE_BUCKET is the actual bucket name (documented contract)
      // S3_BUCKET_PREFIX is legacy multi-bucket mode
      const bucket = process.env['STORAGE_BUCKET'];
      const bucketPrefix = process.env['S3_BUCKET_PREFIX'];

      console.log(`[StorageProvider] Using S3 storage in region ${region}`);
      if (bucket) {
        console.log(`[StorageProvider] Single bucket mode: ${bucket}`);
      } else if (bucketPrefix) {
        console.log(`[StorageProvider] Multi-bucket mode with prefix: ${bucketPrefix}`);
      }

      return new S3StorageProvider({
        region,
        accessKeyId,
        secretAccessKey,
        endpoint,
        forcePathStyle,
        bucket,
        bucketPrefix,
      });
    }
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}

function createEmailProvider(): EmailProvider {
  const provider = process.env['EMAIL_PROVIDER'] ?? 'console';
  const isDev = process.env['NODE_ENV'] !== 'production';

  // Always use console in dev if no email provider configured
  if (isDev && !process.env['SMTP_HOST'] && !process.env['ACS_CONNECTION_STRING']) {
    return new ConsoleEmailProvider();
  }

  switch (provider) {
    case 'acs': {
      const connectionString = process.env['ACS_CONNECTION_STRING'];
      const senderAddress = process.env['ACS_SENDER_ADDRESS'] ?? 'noreply@vaultspace.org';

      if (!connectionString) {
        throw new Error('ACS email requires ACS_CONNECTION_STRING');
      }

      return new AzureCommunicationEmailProvider({
        connectionString,
        senderAddress,
      });
    }
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
