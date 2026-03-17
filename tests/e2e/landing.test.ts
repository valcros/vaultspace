/**
 * Landing Page E2E Tests
 *
 * Tests the public landing page functionality.
 */

import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('should display the landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/VaultSpace/);
  });

  test('should have navigation elements', async ({ page }) => {
    await page.goto('/');

    // Check for main heading
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('should be accessible', async ({ page }) => {
    await page.goto('/');

    // Check basic accessibility - page should have lang attribute
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
  });
});
