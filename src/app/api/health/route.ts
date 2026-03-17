/**
 * Health Check API
 *
 * GET /api/health - Returns health status with dependency checks
 *
 * For liveness: Always returns 200 if the process is running
 * For readiness: Returns 200 only if all dependencies are healthy
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getProviders } from '@/providers';

interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  checks: {
    database: HealthCheck;
    cache: HealthCheck;
    storage: HealthCheck;
  };
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Database connection failed',
    };
  }
}

/**
 * Check Redis/cache connectivity
 */
async function checkCache(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const providers = getProviders();
    const testKey = `health:${Date.now()}`;

    // Try to set and get a value
    await providers.cache.set(testKey, 'ok', 10);
    const value = await providers.cache.get(testKey);
    await providers.cache.delete(testKey);

    if (value !== 'ok') {
      return {
        status: 'degraded',
        latencyMs: Date.now() - start,
        error: 'Cache read/write mismatch',
      };
    }

    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Cache connection failed',
    };
  }
}

/**
 * Check storage connectivity
 */
async function checkStorage(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const providers = getProviders();

    // Try to check if documents container/bucket exists
    // We don't write during health check to avoid creating files
    const testKey = '.health-check-marker';
    const exists = await providers.storage.exists('documents', testKey);

    // If marker doesn't exist, that's fine - we just wanted to verify connectivity
    // The exists() call will throw if storage is unreachable
    void exists;

    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Storage connection failed',
    };
  }
}

/**
 * GET /api/health
 *
 * Query params:
 * - deep=true: Run all dependency checks (slower, for readiness probes)
 * - deep=false or omitted: Quick liveness check only
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const deep = searchParams.get('deep') === 'true';

  const version = process.env['npm_package_version'] ?? '0.1.0';

  // Quick liveness check
  if (!deep) {
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version,
    });
  }

  // Full readiness check with dependency verification
  const [database, cache, storage] = await Promise.all([
    checkDatabase(),
    checkCache(),
    checkStorage(),
  ]);

  // Determine overall status
  const checks = { database, cache, storage };
  const statuses = Object.values(checks).map((c) => c.status);

  let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
  if (statuses.includes('unhealthy')) {
    overallStatus = 'unhealthy';
  } else if (statuses.includes('degraded')) {
    overallStatus = 'degraded';
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version,
    checks,
  };

  // Return 503 Service Unavailable if unhealthy
  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  return NextResponse.json(response, { status: statusCode });
}
