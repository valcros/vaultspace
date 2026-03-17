/**
 * Rate Limiting Middleware
 *
 * Token bucket algorithm using CacheProvider.
 */

import { RATE_LIMIT_CONFIG } from '../constants';
import { RateLimitError } from '../errors';
import { getProviders } from '@/providers';

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
  /** Key prefix for cache */
  prefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
}

/**
 * Check and increment rate limit counter
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const cache = getProviders().cache;
  const key = `ratelimit:${config.prefix}:${identifier}`;

  const count = await cache.increment(key, config.windowSeconds);
  const remaining = Math.max(0, config.limit - count);
  const resetAt = new Date(
    Math.ceil(Date.now() / (config.windowSeconds * 1000)) * (config.windowSeconds * 1000)
  );

  if (count > config.limit) {
    const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter,
    };
  }

  return {
    allowed: true,
    remaining,
    resetAt,
  };
}

/**
 * Assert rate limit or throw error
 */
export async function assertRateLimit(identifier: string, config: RateLimitConfig): Promise<void> {
  const result = await checkRateLimit(identifier, config);
  if (!result.allowed) {
    throw new RateLimitError(result.retryAfter ?? 60);
  }
}

// Pre-configured rate limiters

export const rateLimiters = {
  /**
   * Login attempts per email
   */
  loginByEmail: (email: string) =>
    assertRateLimit(email.toLowerCase(), {
      limit: RATE_LIMIT_CONFIG.LOGIN_ATTEMPTS_PER_EMAIL_PER_MINUTE,
      windowSeconds: 60,
      prefix: 'login:email',
    }),

  /**
   * Login attempts per IP
   */
  loginByIp: (ip: string) =>
    assertRateLimit(ip, {
      limit: RATE_LIMIT_CONFIG.LOGIN_ATTEMPTS_PER_IP_PER_MINUTE,
      windowSeconds: 60,
      prefix: 'login:ip',
    }),

  /**
   * API requests for viewers
   */
  viewerRequests: (userId: string) =>
    assertRateLimit(userId, {
      limit: RATE_LIMIT_CONFIG.VIEWER_REQUESTS_PER_MINUTE,
      windowSeconds: 60,
      prefix: 'api:viewer',
    }),

  /**
   * API requests for admins
   */
  adminRequests: (userId: string) =>
    assertRateLimit(userId, {
      limit: RATE_LIMIT_CONFIG.ADMIN_REQUESTS_PER_MINUTE,
      windowSeconds: 60,
      prefix: 'api:admin',
    }),

  /**
   * Upload rate limit per user
   */
  uploadByUser: (userId: string) =>
    assertRateLimit(userId, {
      limit: RATE_LIMIT_CONFIG.UPLOAD_LIMIT_PER_USER_PER_MINUTE,
      windowSeconds: 60,
      prefix: 'upload:user',
    }),
};
