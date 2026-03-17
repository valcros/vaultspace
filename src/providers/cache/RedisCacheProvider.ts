/**
 * Redis Cache Provider
 *
 * Production-ready cache provider using Redis.
 */

import Redis from 'ioredis';

import type { CacheProvider } from '../types';

export interface RedisCacheConfig {
  url: string;
  prefix?: string;
  tls?: boolean;
}

export class RedisCacheProvider implements CacheProvider {
  private client: Redis;
  private prefix: string;

  constructor(config: RedisCacheConfig) {
    this.prefix = config.prefix ?? 'vaultspace:';

    this.client = new Redis(config.url, {
      tls: config.tls ? {} : undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.client.get(this.key(key));
    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set<T = string>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    if (ttlSeconds) {
      await this.client.setex(this.key(key), ttlSeconds, serialized);
    } else {
      await this.client.set(this.key(key), serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(this.key(key));
    return result === 1;
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    const prefixedKey = this.key(key);
    const result = await this.client.incr(prefixedKey);

    if (ttlSeconds && result === 1) {
      // Set TTL only on first increment
      await this.client.expire(prefixedKey, ttlSeconds);
    }

    return result;
  }

  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(this.key(key), value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Get the underlying Redis client for advanced operations
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Close the Redis connection
   */
  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}
