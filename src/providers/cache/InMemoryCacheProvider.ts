/**
 * In-Memory Cache Provider
 *
 * Development fallback when Redis is not available.
 * NOT suitable for production multi-instance deployments.
 */

import type { CacheProvider } from '../types';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

export class InMemoryCacheProvider implements CacheProvider {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  async get<T = string>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T = string>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.cache.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    const current = await this.get<number>(key);
    const newValue = (current ?? 0) + 1;
    await this.set(key, newValue, ttlSeconds);
    return newValue;
  }

  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (await this.exists(key)) {
      return false;
    }
    await this.set(key, value, ttlSeconds);
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}
