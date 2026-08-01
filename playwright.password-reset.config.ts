import { defineConfig, devices } from '@playwright/test';

import { assertPasswordResetE2eEnvironment } from './scripts/password-reset-e2e-guard';

const { baseUrl } = assertPasswordResetE2eEnvironment();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'password-reset-first-dashboard.test.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: baseUrl.toString(),
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'password-reset-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env['PLAYWRIGHT_WEB_SERVER_COMMAND'] || 'node .next/standalone/server.js',
    url: baseUrl.toString(),
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
