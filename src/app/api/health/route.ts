/**
 * Health Check API
 *
 * GET /api/health - Returns health status with dependency checks
 *
 * For liveness: Always returns 200 if the process is running
 * For readiness: Returns 200 only if critical dependencies are healthy
 *
 * Note: Degraded capabilities (missing ClamAV, Gotenberg, Redis in standalone mode)
 * do NOT fail readiness - only infrastructure failures (db, storage) fail readiness.
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getProviders } from '@/providers';
import { getDeploymentMode, type DeploymentMode } from '@/lib/deployment-mode';
import {
  resolveCapabilities,
  getDegradedCapabilities,
  type DeploymentCapabilities,
} from '@/lib/deployment-capabilities';

interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  mode: DeploymentMode;
  capabilities: DeploymentCapabilities;
  degraded: (keyof DeploymentCapabilities)[];
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
 * Check Redis/cache connectivity.
 *
 * In Azure mode: Redis failure is unhealthy (critical)
 * In Standalone mode: Redis failure is degraded (optional but recommended)
 */
async function checkCache(): Promise<HealthCheck> {
  const start = Date.now();
  const mode = getDeploymentMode();

  // If no Redis configured, return degraded in standalone, unhealthy in Azure
  if (!process.env['REDIS_URL']) {
    if (mode === 'standalone') {
      return {
        status: 'degraded',
        latencyMs: 0,
        error: 'Redis not configured (async features unavailable)',
      };
    }
    return {
      status: 'unhealthy',
      latencyMs: 0,
      error: 'Redis not configured (required in Azure mode)',
    };
  }

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
    // In standalone mode, cache failure is degraded, not unhealthy
    const status = mode === 'standalone' ? 'degraded' : 'unhealthy';
    return {
      status,
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

  const mode = getDeploymentMode();
  const capabilities = resolveCapabilities();
  const degraded = getDegradedCapabilities();

  // Quick liveness check
  if (!deep) {
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version,
      mode,
      capabilities,
      degraded,
    });
  }

  // Full readiness check with dependency verification
  const [database, cache, storage] = await Promise.all([
    checkDatabase(),
    checkCache(),
    checkStorage(),
  ]);

  // Determine overall status
  // Only database and storage failures cause unhealthy status
  // Cache failures in standalone mode are degraded, not unhealthy
  const checks = { database, cache, storage };

  let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

  // Critical infrastructure: database and storage must be healthy
  if (database.status === 'unhealthy' || storage.status === 'unhealthy') {
    overallStatus = 'unhealthy';
  } else if (cache.status === 'unhealthy') {
    // In Azure mode, cache failure is unhealthy; in standalone, it's degraded
    overallStatus = mode === 'azure' ? 'unhealthy' : 'degraded';
  } else if (
    database.status === 'degraded' ||
    storage.status === 'degraded' ||
    cache.status === 'degraded'
  ) {
    overallStatus = 'degraded';
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version,
    mode,
    capabilities,
    degraded,
    checks,
  };

  // Return 503 Service Unavailable only if unhealthy
  // Degraded is still 200 (ready to serve, with reduced functionality)
  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  return NextResponse.json(response, { status: statusCode });
}
