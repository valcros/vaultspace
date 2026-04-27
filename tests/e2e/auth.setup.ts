/**
 * Playwright auth setup — runs once before any test in projects that depend on
 * `auth-setup`. Logs in as the demo admin and saves the session storage state
 * to `tests/e2e/.auth/admin.json`. Tests can then declare
 *
 *   test.use({ storageState: 'tests/e2e/.auth/admin.json' })
 *
 * to skip the login flow and start authenticated.
 *
 * Credentials come from PLAYWRIGHT_ADMIN_EMAIL / PLAYWRIGHT_ADMIN_PASSWORD
 * with sensible defaults matching `prisma/seed.ts`.
 */
import { test as setup, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env['PLAYWRIGHT_ADMIN_EMAIL'] || 'admin@demo.vaultspace.app';
const ADMIN_PASSWORD = process.env['PLAYWRIGHT_ADMIN_PASSWORD'] || 'Demo123!';

const ADMIN_STORAGE_STATE = 'tests/e2e/.auth/admin.json';

setup('authenticate as admin', async ({ page }) => {
  page.on('response', (resp) => {
    if (resp.url().includes('/api/auth/login')) {
      console.log(`[auth-setup] login response: ${resp.status()} ${resp.url()}`);
    }
  });
  page.on('request', (req) => {
    if (req.url().includes('/api/auth/login')) {
      console.log(`[auth-setup] login request: ${req.method()} ${req.url()} body=${req.postData()?.slice(0, 80)}`);
    }
  });

  await page.goto('/auth/login');
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  // Post-login lands on /dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
