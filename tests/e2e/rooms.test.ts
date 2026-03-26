/**
 * E2E Tests: Room Management
 *
 * Tests room CRUD operations via the live UI.
 * Requires demo seed data (admin@demo.vaultspace.app / Demo123!).
 */

import { test, expect } from '@playwright/test';

// Login helper - reused across tests
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', 'admin@demo.vaultspace.app');
  await page.fill('input[type="password"]', 'Demo123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/rooms', { timeout: 10000 });
}

test.describe('Room Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('rooms dashboard displays seed data', async ({ page }) => {
    await expect(page.locator('text=Data Rooms')).toBeVisible();
    await expect(page.locator('text=Due Diligence Package')).toBeVisible();
    await expect(page.locator('text=Create Room')).toBeVisible();
  });

  test('room detail page shows documents and tabs', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    // Verify breadcrumbs
    await expect(page.locator('text=Rooms')).toBeVisible();

    // Verify tabs
    await expect(page.locator('text=Documents')).toBeVisible();
    await expect(page.locator('text=Members')).toBeVisible();
    await expect(page.locator('text=Share Links')).toBeVisible();

    // Verify folders from seed data
    await expect(page.locator('text=Financials')).toBeVisible();
    await expect(page.locator('text=Legal')).toBeVisible();
    await expect(page.locator('text=Technical')).toBeVisible();
  });

  test('can navigate into folders', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    // Click into Financials folder
    await page.click('text=Financials');
    await page.waitForTimeout(1000);

    // Breadcrumbs should update
    await expect(page.locator('text=Financials').last()).toBeVisible();
  });

  test('members tab loads', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await page.click('role=tab[name="Members"]');
    await page.waitForTimeout(1000);

    // Should show admin members
    await expect(page.locator('text=Demo Admin').first()).toBeVisible();
  });

  test('share links tab loads', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await page.click('role=tab[name="Share Links"]');
    await page.waitForTimeout(1000);

    // Should show create link button or existing links
    await expect(
      page.locator('text=Create Link').or(page.locator('text=No share links'))
    ).toBeVisible();
  });
});

test.describe('Room Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('room settings page loads with current values', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await page.click('text=Settings');
    await page.waitForURL('**/settings', { timeout: 5000 });

    await expect(page.locator('input[id="name"]')).toBeVisible();
    await expect(page.locator('text=Danger Zone').or(page.locator('text=Delete'))).toBeVisible();
  });
});
