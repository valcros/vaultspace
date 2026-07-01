import { describe, expect, it, vi } from 'vitest';

import {
  wakeQueueDelayedJobs,
  type DelayedWakeQueue,
  type PromotableDelayedJob,
} from './BullMQDelayedJobWaker';

function createJob(
  id: string,
  options: { timestamp?: number; delay?: number; promote?: () => Promise<void> } = {}
): PromotableDelayedJob {
  return {
    id,
    timestamp: options.timestamp ?? 1000,
    delay: options.delay ?? 0,
    promote: options.promote ?? vi.fn().mockResolvedValue(undefined),
  };
}

function createQueue(jobs: PromotableDelayedJob[] = []) {
  const getDelayed = vi.fn().mockResolvedValue(jobs);
  const queue: DelayedWakeQueue = {
    name: 'high',
    getDelayed,
  };

  return { queue, getDelayed };
}

describe('wakeQueueDelayedJobs', () => {
  it('promotes only delayed jobs whose BullMQ metadata says they are due', async () => {
    const promoteDue = vi.fn().mockResolvedValue(undefined);
    const promoteFuture = vi.fn().mockResolvedValue(undefined);
    const dueJob = createJob('job-due', {
      timestamp: 900,
      delay: 100,
      promote: promoteDue,
    });
    const futureJob = createJob('job-future', {
      timestamp: 1000,
      delay: 100,
      promote: promoteFuture,
    });
    const { queue, getDelayed } = createQueue([dueJob, futureJob]);

    const result = await wakeQueueDelayedJobs(queue, {
      nowMs: 1000,
      batchSize: 25,
    });

    expect(getDelayed).toHaveBeenCalledWith(0, 24);
    expect(promoteDue).toHaveBeenCalledTimes(1);
    expect(promoteFuture).not.toHaveBeenCalled();
    expect(result.inspectedJobIds).toEqual(['job-due', 'job-future']);
    expect(result.dueJobIds).toEqual(['job-due']);
    expect(result.promotedJobIds).toEqual(['job-due']);
    expect(result.failedJobs).toEqual([]);
  });

  it('uses graceMs deliberately when selecting due jobs', async () => {
    const promote = vi.fn().mockResolvedValue(undefined);
    const { queue } = createQueue([
      createJob('job-within-grace', {
        timestamp: 1000,
        delay: 250,
        promote,
      }),
    ]);

    const result = await wakeQueueDelayedJobs(queue, {
      nowMs: 1000,
      graceMs: 250,
    });

    expect(promote).toHaveBeenCalledTimes(1);
    expect(result.dueJobIds).toEqual(['job-within-grace']);
  });

  it('does not promote jobs during a dry run', async () => {
    const promote = vi.fn().mockResolvedValue(undefined);
    const { queue } = createQueue([createJob('job-1', { promote })]);

    const result = await wakeQueueDelayedJobs(queue, {
      nowMs: 1000,
      dryRun: true,
    });

    expect(promote).not.toHaveBeenCalled();
    expect(result.inspectedJobIds).toEqual(['job-1']);
    expect(result.dueJobIds).toEqual(['job-1']);
    expect(result.promotedJobIds).toEqual([]);
  });

  it('treats not-in-delayed promotion errors as races', async () => {
    const promote = vi.fn().mockRejectedValue(new Error('Job job-1 is not in delayed state'));
    const { queue } = createQueue([createJob('job-1', { promote })]);

    const result = await wakeQueueDelayedJobs(queue, {
      nowMs: 1000,
    });

    expect(result.promotedJobIds).toEqual([]);
    expect(result.skippedJobIds).toEqual(['job-1']);
    expect(result.failedJobs).toEqual([]);
  });

  it('reports unexpected promotion failures', async () => {
    const promote = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const { queue } = createQueue([createJob('job-1', { promote })]);

    const result = await wakeQueueDelayedJobs(queue, {
      nowMs: 1000,
    });

    expect(result.promotedJobIds).toEqual([]);
    expect(result.skippedJobIds).toEqual([]);
    expect(result.failedJobs).toEqual([{ jobId: 'job-1', error: 'redis unavailable' }]);
  });
});
