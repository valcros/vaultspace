/**
 * One-shot BullMQ delayed job waker.
 *
 * Intended for a lightweight scheduled Azure Container Apps Job. It promotes due
 * delayed retry jobs into wait lists so the existing KEDA Redis list rules can
 * scale the main worker from zero.
 */

import { wakeDueDelayedJobs } from '@/providers/job/BullMQDelayedJobWaker';

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseQueueNames(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const queueNames = value
    .split(',')
    .map((queueName) => queueName.trim())
    .filter(Boolean);

  return queueNames.length > 0 ? queueNames : undefined;
}

async function main() {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    console.error('[DelayedJobWaker] REDIS_URL is required');
    process.exitCode = 1;
    return;
  }

  const summary = await wakeDueDelayedJobs({
    redisUrl,
    prefix: process.env['JOB_QUEUE_PREFIX'] ?? 'vaultspace:jobs:',
    queueNames: parseQueueNames(process.env['BULLMQ_WAKE_QUEUES']),
    batchSize: parseInteger(process.env['BULLMQ_WAKE_BATCH_SIZE'], 100),
    graceMs: parseInteger(process.env['BULLMQ_WAKE_GRACE_MS'], 0),
    dryRun: process.env['BULLMQ_WAKE_DRY_RUN'] === 'true',
  });

  const promotedCount = summary.results.reduce(
    (count, result) => count + result.promotedJobIds.length,
    0
  );
  const failedCount = summary.results.reduce(
    (count, result) => count + result.failedJobs.length,
    0
  );

  console.log(
    JSON.stringify(
      {
        status: failedCount > 0 ? 'failed' : 'ok',
        promotedCount,
        failedCount,
        summary,
      },
      null,
      2
    )
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[DelayedJobWaker] Fatal error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
