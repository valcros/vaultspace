/**
 * Vitest Integration Test Configuration
 *
 * Integration tests run against Docker services (PostgreSQL, Redis).
 * Requires docker-compose services to be running.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules', '.next'],
    testTimeout: 30000, // Integration tests may be slower
    hookTimeout: 30000,
    setupFiles: ['./vitest.integration.setup.ts'],
    // Run integration tests sequentially to avoid database conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Environment variables for integration tests
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env['DATABASE_URL'] || 'postgresql://postgres:postgres@localhost:5432/vaultspace_test',
      REDIS_URL: process.env['REDIS_URL'] || 'redis://localhost:6379',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
