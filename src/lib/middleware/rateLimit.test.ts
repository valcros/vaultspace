/**
 * Rate Limiting Unit Tests
 *
 * Tests for the token bucket rate limiting algorithm.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RateLimitConfig } from './rateLimit';
import { assertRateLimit, checkRateLimit } from './rateLimit';
import { RateLimitError } from '../errors';

// Mock providers
const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  increment: vi.fn(),
  setNX: vi.fn(),
};

vi.mock('@/providers', () => ({
  getProviders: () => ({
    cache: mockCache,
  }),
}));

describe('Rate Limiting', () => {
  const testConfig: RateLimitConfig = {
    limit: 100,
    windowSeconds: 60,
    prefix: 'test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Set time to 30 seconds into a minute to test reset boundary properly
    vi.setSystemTime(new Date('2024-01-01T00:00:30Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkRateLimit', () => {
    it('should allow first request', async () => {
      mockCache.increment.mockResolvedValue(1);

      const result = await checkRateLimit('user-1', testConfig);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
      expect(mockCache.increment).toHaveBeenCalledWith('ratelimit:test:user-1', 60);
    });

    it('should allow requests up to the limit', async () => {
      mockCache.increment.mockResolvedValue(100);

      const result = await checkRateLimit('user-2', testConfig);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should block the 101st request', async () => {
      mockCache.increment.mockResolvedValue(101);

      const result = await checkRateLimit('user-3', testConfig);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
      expect(typeof result.retryAfter).toBe('number');
    });

    it('should block heavily over-limit requests', async () => {
      mockCache.increment.mockResolvedValue(500);

      const result = await checkRateLimit('user-4', testConfig);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should calculate correct remaining count', async () => {
      mockCache.increment.mockResolvedValue(50);

      const result = await checkRateLimit('user-5', testConfig);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
    });

    it('should provide resetAt time', async () => {
      mockCache.increment.mockResolvedValue(1);

      const result = await checkRateLimit('user-6', testConfig);

      expect(result.resetAt).toBeInstanceOf(Date);
      // Reset should be at a minute boundary (divisible by 60000ms)
      expect(result.resetAt.getTime() % 60000).toBe(0);
    });

    it('should work with different config limits', async () => {
      const strictConfig: RateLimitConfig = {
        limit: 5,
        windowSeconds: 60,
        prefix: 'strict',
      };

      mockCache.increment.mockResolvedValue(6);

      const result = await checkRateLimit('user-7', strictConfig);

      expect(result.allowed).toBe(false);
    });
  });

  describe('assertRateLimit', () => {
    it('should not throw when under limit', async () => {
      mockCache.increment.mockResolvedValue(50);

      await expect(assertRateLimit('user-8', testConfig)).resolves.toBeUndefined();
    });

    it('should throw RateLimitError when over limit', async () => {
      mockCache.increment.mockResolvedValue(101);

      await expect(assertRateLimit('user-9', testConfig)).rejects.toThrow(RateLimitError);
    });

    it('should include retryAfter in the error', async () => {
      mockCache.increment.mockResolvedValue(101);

      try {
        await assertRateLimit('user-10', testConfig);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).retryAfter).toBeDefined();
        expect(typeof (error as RateLimitError).retryAfter).toBe('number');
      }
    });
  });

  describe('edge cases', () => {
    it('should use the correct cache key format', async () => {
      mockCache.increment.mockResolvedValue(1);

      await checkRateLimit('test@example.com', {
        limit: 10,
        windowSeconds: 60,
        prefix: 'login:email',
      });

      expect(mockCache.increment).toHaveBeenCalledWith(
        'ratelimit:login:email:test@example.com',
        60
      );
    });

    it('should handle special characters in identifier', async () => {
      mockCache.increment.mockResolvedValue(1);

      await checkRateLimit('192.168.1.100', {
        limit: 10,
        windowSeconds: 60,
        prefix: 'login:ip',
      });

      expect(mockCache.increment).toHaveBeenCalledWith('ratelimit:login:ip:192.168.1.100', 60);
    });
  });
});
