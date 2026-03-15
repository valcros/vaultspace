/**
 * VaultSpace Worker Entry Point
 *
 * Bootstraps background workers based on WORKER_TYPE environment variable.
 * Worker types: general, preview, scan, report
 */

import { Worker, type ConnectionOptions, type Job } from 'bullmq';

import {
  processEmailJob,
  processPreviewJob,
  processScanJob,
  processSearchIndexJob,
  processTextExtractJob,
  processThumbnailJob,
} from './processors';
import { JOB_NAMES, QUEUE_NAMES } from './types';

type WorkerType = 'general' | 'preview' | 'scan' | 'report';

const workerType = (process.env['WORKER_TYPE'] ?? 'general') as WorkerType;

console.log(`[VaultSpace Worker] Starting ${workerType} worker...`);
console.log(`[VaultSpace Worker] Environment: ${process.env['NODE_ENV'] ?? 'development'}`);

// Build Redis connection options
function getConnectionOptions(): ConnectionOptions | undefined {
  const redisUrl = process.env['REDIS_URL'];

  if (!redisUrl) {
    console.log('[VaultSpace Worker] No REDIS_URL configured, workers disabled');
    return undefined;
  }

  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
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

const WORKER_CONFIGS: Record<WorkerType, WorkerConfig> = {
  general: {
    queues: [QUEUE_NAMES.NORMAL],
    concurrency: 4,
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

  if (!connection) {
    console.log('[VaultSpace Worker] Running in stub mode (no Redis)');
    // Keep process alive but do nothing
    await new Promise(() => {});
    return;
  }

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
