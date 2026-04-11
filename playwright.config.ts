/**
 * Playwright E2E Test Configuration
 *
 * End-to-end tests for VaultSpace.
 * Run with: npm run test:e2e
 */

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['PLAYWRIGHT_BASE_URL'] || 'http://localhost:3000';
const usesLocalServer = /localhost|127\.0\.0\.1/.test(baseURL);
const webServerCommand =
  process.env['PLAYWRIGHT_WEB_SERVER_COMMAND'] ||
  (usesLocalServer ? 'npm run dev:standalone' : 'npm run dev');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  timeout: 30000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Add more browsers for CI
    ...(process.env['CI']
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
          },
        ]
      : []),
  ],

  // Launch a local standalone server only when the test target is local.
  webServer: usesLocalServer
    ? {
        command: webServerCommand,
        url: baseURL,
        reuseExistingServer: !process.env['CI'],
        timeout: 120000,
      }
    : undefined,
});
