/**
 * Vitest Integration Test Configuration
 *
 * Azure mode: Integration tests must run against Azure-hosted services.
 * Standalone mode: Local execution is permitted for self-hosted validation.
 *
 * Required environment variables:
 * - DATABASE_URL: Azure PostgreSQL connection string
 * - REDIS_URL: Azure Cache for Redis connection string (if used)
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

const isStandalone = process.env['DEPLOYMENT_MODE'] === 'standalone';

// Validate integration test configuration
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error(
    '\n\n🚫 DATABASE_URL is required for integration tests.\n' +
      (isStandalone
        ? 'Set DATABASE_URL to point to your standalone PostgreSQL instance.\n'
        : 'Set DATABASE_URL to point to Azure PostgreSQL.\n')
  );
}

if (!isStandalone && (databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1'))) {
  throw new Error(
    '\n\n🚫 INTEGRATION TESTS BLOCKED\n\n' +
      'DATABASE_URL points to localhost, which is not permitted.\n' +
      'VaultSpace integration tests must run against Azure PostgreSQL.\n\n' +
      'Current value: ' +
      databaseUrl.replace(/:[^:@]+@/, ':****@') +
      '\n\n' +
      'Required: Azure PostgreSQL URL (.database.azure.com)\n' +
      'Or run with DEPLOYMENT_MODE=standalone for local integration testing.\n'
  );
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules', '.next'],
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./vitest.integration.setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    env: {
      NODE_ENV: 'test',
      // No defaults - Azure configuration is required
      DATABASE_URL: process.env['DATABASE_URL'],
      REDIS_URL: process.env['REDIS_URL'],
      AZURE_ONLY: isStandalone ? 'false' : 'true',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
