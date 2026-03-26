/**
 * BullMQ Job Provider
 *
 * Implements the JobProvider interface using BullMQ.
 */

import { Queue, Job, type ConnectionOptions } from 'bullmq';

import type { JobOptions, JobPriority, JobProvider } from '../types';

const PRIORITY_MAP: Record<JobPriority, number> = {
  high: 1,
  normal: 2,
  low: 3,
};

export interface BullMQJobProviderOptions {
  redisUrl?: string;
  redisOptions?: {
    host?: string;
    port?: number;
    password?: string;
    tls?: boolean;
  };
  prefix?: string;
}

export class BullMQJobProvider implements JobProvider {
  private connectionOptions: ConnectionOptions;
  private queues: Map<string, Queue> = new Map();
  private prefix: string;

  constructor(options: BullMQJobProviderOptions = {}) {
    this.prefix = options.prefix ?? 'vaultspace:jobs:';

    // Build connection options for BullMQ
    if (options.redisUrl) {
      // Parse Redis URL for BullMQ connection
      const url = new URL(options.redisUrl);
      const useTls = url.protocol === 'rediss:';
      this.connectionOptions = {
        host: url.hostname,
        port: parseInt(url.port || (useTls ? '6380' : '6379'), 10),
        password: url.password ? decodeURIComponent(url.password) : undefined,
        tls: useTls ? {} : undefined,
        maxRetriesPerRequest: null,
      };
    } else if (options.redisOptions) {
      this.connectionOptions = {
        host: options.redisOptions.host ?? 'localhost',
        port: options.redisOptions.port ?? 6379,
        password: options.redisOptions.password,
        tls: options.redisOptions.tls ? {} : undefined,
        maxRetriesPerRequest: null,
      };
    } else {
      this.connectionOptions = {
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null,
      };
    }
  }

  /**
   * Get or create a queue
   */
  private getQueue(queueName: string): Queue {
    if (!this.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: this.connectionOptions,
        prefix: this.prefix,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            age: 3600, // Keep completed jobs for 1 hour
            count: 1000,
          },
          removeOnFail: {
            age: 86400, // Keep failed jobs for 24 hours
            count: 5000,
          },
        },
      });
      this.queues.set(queueName, queue);
    }
    return this.queues.get(queueName)!;
  }

  /**
   * Add a job to the queue
   */
  async addJob<T>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobOptions
  ): Promise<string> {
    const queue = this.getQueue(queueName);

    const job = await queue.add(jobName, data, {
      priority: options?.priority ? PRIORITY_MAP[options.priority] : PRIORITY_MAP.normal,
      delay: options?.delay,
      attempts: options?.attempts,
      backoff: options?.backoff,
    });

    return job.id ?? `job-${Date.now()}`;
  }

  /**
   * Get job status
   */
  async getJobStatus(queueName: string, jobId: string): Promise<string> {
    const queue = this.getQueue(queueName);
    const job = await Job.fromId(queue, jobId);

    if (!job) {
      return 'unknown';
    }

    const state = await job.getState();
    return state;
  }

  /**
   * Cancel a pending job
   */
  async cancelJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const job = await Job.fromId(queue, jobId);

    if (job) {
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
      }
    }
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    const queues = Array.from(this.queues.values());
    for (const queue of queues) {
      await queue.close();
    }
  }
}
