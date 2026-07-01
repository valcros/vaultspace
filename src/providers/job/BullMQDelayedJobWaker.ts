/**
 * BullMQ delayed job waker.
 *
 * KEDA Redis list scalers can wake a zero-replica worker for jobs in BullMQ wait
 * lists, but BullMQ retry backoff jobs live in delayed zsets. This helper promotes
 * only delayed jobs whose BullMQ metadata says they are due, making them visible
 * to the existing wait-list scale rules without keeping the worker warm.
 */

import { Queue, type ConnectionOptions } from 'bullmq';

import { QUEUE_NAMES } from '@/workers/types';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_QUEUE_NAMES = [QUEUE_NAMES.HIGH, QUEUE_NAMES.NORMAL, QUEUE_NAMES.LOW];

export interface DelayedWakeQueue {
  name: string;
  getDelayed(start?: number, end?: number): Promise<PromotableDelayedJob[]>;
}

export interface PromotableDelayedJob {
  id?: string;
  timestamp: number;
  delay: number;
  promote(): Promise<void>;
}

export interface WakeQueueDelayedJobsOptions {
  nowMs?: number;
  graceMs?: number;
  batchSize?: number;
  dryRun?: boolean;
}

export interface WakeQueueDelayedJobsResult {
  queueName: string;
  inspectedJobIds: string[];
  dueJobIds: string[];
  promotedJobIds: string[];
  skippedJobIds: string[];
  failedJobs: Array<{ jobId: string; error: string }>;
}

export interface WakeDueDelayedJobsOptions {
  redisUrl?: string;
  redisOptions?: {
    host?: string;
    port?: number;
    password?: string;
    tls?: boolean;
  };
  prefix?: string;
  queueNames?: string[];
  nowMs?: number;
  graceMs?: number;
  batchSize?: number;
  dryRun?: boolean;
}

export interface WakeDueDelayedJobsSummary {
  queueNames: string[];
  batchSize: number;
  dryRun: boolean;
  results: WakeQueueDelayedJobsResult[];
}

function buildConnectionOptions(options: WakeDueDelayedJobsOptions): ConnectionOptions {
  if (options.redisUrl) {
    const url = new URL(options.redisUrl);
    const useTls = url.protocol === 'rediss:';
    return {
      host: url.hostname,
      port: parseInt(url.port || (useTls ? '6380' : '6379'), 10),
      password: url.password ? decodeURIComponent(url.password) : undefined,
      tls: useTls ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }

  return {
    host: options.redisOptions?.host ?? 'localhost',
    port: options.redisOptions?.port ?? 6379,
    password: options.redisOptions?.password,
    tls: options.redisOptions?.tls ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

function normalizeBatchSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeGraceMs(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function isDelayedStateRace(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  if (code === -3) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('not in delayed');
}

function isDue(job: PromotableDelayedJob, nowMs: number, graceMs: number): boolean {
  return job.timestamp + job.delay <= nowMs + graceMs;
}

export async function wakeQueueDelayedJobs(
  queue: DelayedWakeQueue,
  options: WakeQueueDelayedJobsOptions = {}
): Promise<WakeQueueDelayedJobsResult> {
  const nowMs = options.nowMs ?? Date.now();
  const graceMs = normalizeGraceMs(options.graceMs);
  const batchSize = normalizeBatchSize(options.batchSize);
  const delayedJobs = await queue.getDelayed(0, batchSize - 1);
  const dueJobs = delayedJobs.filter((job) => job.id && isDue(job, nowMs, graceMs));

  const result: WakeQueueDelayedJobsResult = {
    queueName: queue.name,
    inspectedJobIds: delayedJobs.map((job) => job.id).filter((id): id is string => !!id),
    dueJobIds: dueJobs.map((job) => job.id).filter((id): id is string => !!id),
    promotedJobIds: [],
    skippedJobIds: [],
    failedJobs: [],
  };

  if (options.dryRun) {
    return result;
  }

  for (const job of dueJobs) {
    try {
      await job.promote();
      result.promotedJobIds.push(job.id!);
    } catch (error) {
      if (isDelayedStateRace(error)) {
        result.skippedJobIds.push(job.id!);
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      result.failedJobs.push({ jobId: job.id!, error: message });
    }
  }

  return result;
}

export async function wakeDueDelayedJobs(
  options: WakeDueDelayedJobsOptions = {}
): Promise<WakeDueDelayedJobsSummary> {
  const queueNames = options.queueNames?.length ? options.queueNames : DEFAULT_QUEUE_NAMES;
  const batchSize = normalizeBatchSize(options.batchSize);
  const connection = buildConnectionOptions(options);
  const prefix = options.prefix ?? 'vaultspace:jobs:';
  const results: WakeQueueDelayedJobsResult[] = [];

  for (const queueName of queueNames) {
    const queue = new Queue(queueName, {
      connection,
      prefix,
    });

    try {
      results.push(
        await wakeQueueDelayedJobs(queue, {
          nowMs: options.nowMs,
          graceMs: options.graceMs,
          batchSize,
          dryRun: options.dryRun,
        })
      );
    } finally {
      await queue.close();
    }
  }

  return {
    queueNames,
    batchSize,
    dryRun: options.dryRun === true,
    results,
  };
}
