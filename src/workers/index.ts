/**
 * VaultSpace Worker Entry Point
 *
 * Bootstraps background workers based on WORKER_TYPE environment variable.
 * Worker types: general, preview, scan, report
 *
 * Workers require Redis in both Azure and Standalone modes.
 * The BullMQ job queue is the backbone of all async processing.
 */

import { enforceDeploymentMode, validateConfig } from '@/lib/azure-guard';
import { getDeploymentMode } from '@/lib/deployment-mode';

const mode = getDeploymentMode();

// Enforce deployment mode restrictions
enforceDeploymentMode();

// Validate configuration - workers require Redis regardless of mode
const { valid, errors, warnings } = validateConfig();
if (!valid) {
  console.error(
    `[VaultSpace Worker] STARTUP BLOCKED - Missing required configuration for ${mode} mode:`
  );
  errors.forEach((err) => console.error(`  - ${err}`));
  console.error('\nSee DEPLOYMENT.md for configuration requirements.\n');
  process.exit(1);
}

// Workers always require Redis - check explicitly
if (!process.env['REDIS_URL']) {
  console.error('[VaultSpace Worker] STARTUP BLOCKED - Redis is required for workers.');
  console.error(
    '  Workers use BullMQ for job processing, which requires Redis in both deployment modes.'
  );
  console.error('  Set REDIS_URL to your Redis instance (Azure Cache for Redis or any Redis 6+).');
  process.exit(1);
}

// Log warnings
if (warnings.length > 0) {
  console.warn(`[VaultSpace Worker] Configuration warnings:`);
  warnings.forEach((warn) => console.warn(`  - ${warn}`));
}

import { Worker, type ConnectionOptions, type Job } from 'bullmq';

import {
  processEmailJob,
  processDocumentUploadedNotification,
  processDocumentViewedNotification,
  processPreviewJob,
  processRoomExportJob,
  processScanJob,
  processSearchIndexJob,
  processTextExtractJob,
  processThumbnailJob,
} from './processors';
import { JOB_NAMES, QUEUE_NAMES } from './types';

type WorkerType = 'general' | 'preview' | 'scan' | 'report';

const workerType = (process.env['WORKER_TYPE'] ?? 'general') as WorkerType;

console.log(`[VaultSpace Worker] Starting ${workerType} worker in ${mode} mode...`);
console.log(`[VaultSpace Worker] Environment: ${process.env['NODE_ENV'] ?? 'development'}`);

// Build Redis connection options
function getConnectionOptions(): ConnectionOptions {
  // REDIS_URL is guaranteed to exist - checked at startup
  const redisUrl = process.env['REDIS_URL']!;

  const url = new URL(redisUrl);
  const useTls = url.protocol === 'rediss:';
  return {
    host: url.hostname,
    port: parseInt(url.port || (useTls ? '6380' : '6379'), 10),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: useTls ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

// Job processor dispatcher
async function processJob(job: Job): Promise<void> {
  const jobName = job.name;

  console.log(`[VaultSpace Worker] Processing job: ${jobName} (${job.id})`);

  switch (jobName) {
    case JOB_NAMES.DOCUMENT_SCAN:
      await processScanJob(job);
      break;

    case JOB_NAMES.PREVIEW_GENERATE:
      await processPreviewJob(job);
      break;

    case JOB_NAMES.THUMBNAIL_GENERATE:
      await processThumbnailJob(job);
      break;

    case JOB_NAMES.TEXT_EXTRACT:
      await processTextExtractJob(job);
      break;

    case JOB_NAMES.SEARCH_INDEX:
      await processSearchIndexJob(job);
      break;

    case JOB_NAMES.EMAIL_SEND:
      await processEmailJob(job);
      break;

    case JOB_NAMES.NOTIFY_DOCUMENT_UPLOADED:
      await processDocumentUploadedNotification(job);
      break;

    case JOB_NAMES.NOTIFY_DOCUMENT_VIEWED:
      await processDocumentViewedNotification(job);
      break;

    case JOB_NAMES.ROOM_EXPORT:
      await processRoomExportJob(job);
      break;

    default:
      console.warn(`[VaultSpace Worker] Unknown job type: ${jobName}`);
  }

  console.log(`[VaultSpace Worker] Job completed: ${jobName} (${job.id})`);
}

// Worker configuration by type
interface WorkerConfig {
  queues: string[];
  concurrency: number;
}

// The `general` worker drains every queue (HIGH, NORMAL, LOW). This lets a single
// worker Container App handle previews, scans, notifications, exports, and cleanup
// without operating multiple worker apps. Specialized worker types remain available
// for future scale-out where dedicated capacity is justified.
const WORKER_CONFIGS: Record<WorkerType, WorkerConfig> = {
  general: {
    queues: [QUEUE_NAMES.HIGH, QUEUE_NAMES.NORMAL, QUEUE_NAMES.LOW],
    concurrency: 6,
  },
  preview: {
    queues: [QUEUE_NAMES.HIGH],
    concurrency: 2,
  },
  scan: {
    queues: [QUEUE_NAMES.HIGH],
    concurrency: 2,
  },
  report: {
    queues: [QUEUE_NAMES.LOW],
    concurrency: 1,
  },
};

async function main() {
  const connection = getConnectionOptions();
  const config = WORKER_CONFIGS[workerType];
  const workers: Worker[] = [];
  const prefix = process.env['JOB_QUEUE_PREFIX'] ?? 'vaultspace:jobs:';

  // Create workers for each queue this worker type handles
  for (const queueName of config.queues) {
    const worker = new Worker(queueName, processJob, {
      connection,
      prefix,
      concurrency: config.concurrency,
    });

    worker.on('completed', (job) => {
      console.log(`[VaultSpace Worker] Job ${job.id} completed`);
    });

    worker.on('failed', (job, error) => {
      console.error(`[VaultSpace Worker] Job ${job?.id} failed:`, error.message);
    });

    worker.on('error', (error) => {
      console.error(`[VaultSpace Worker] Worker error:`, error);
    });

    workers.push(worker);
    console.log(`[VaultSpace Worker] Listening on queue: ${queueName}`);
  }

  console.log(`[VaultSpace Worker] ${workerType} worker initialized`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[VaultSpace Worker] Received ${signal}, shutting down...`);

    for (const worker of workers) {
      await worker.close();
    }

    console.log('[VaultSpace Worker] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[VaultSpace Worker] Fatal error:', error);
  process.exit(1);
});
