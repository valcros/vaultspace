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
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  await page.goto('/rooms');
  await page.waitForURL('**/rooms', { timeout: 10000 });
}

test.describe('Room Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('rooms dashboard displays seed data', async ({ page }) => {
    await expect(page.locator('text=Data Rooms')).toBeVisible();
    await expect(page.locator('text=Due Diligence Package')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Create Room' })).toBeVisible();
  });

  test('room detail page shows documents and tabs', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    // Verify breadcrumbs
    await expect(page.locator('text=Rooms')).toBeVisible();

    // Verify tabs
    await expect(page.getByRole('tab', { name: 'Documents' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Access' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Share Links' })).toBeVisible();

    // Verify seeded room content loads.
    await expect(page.getByRole('cell', { name: 'Financials' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('cell', { name: 'Legal' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Technical' })).toBeVisible();
  });

  test('can navigate into folders', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    // Click into Financials folder once seeded content has loaded.
    await page.getByRole('cell', { name: 'Financials' }).click({ timeout: 15000 });
    await page.waitForTimeout(1000);

    // Breadcrumbs should update
    await expect(page.locator('text=Financials').last()).toBeVisible();
  });

  test('members tab loads', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await page.getByRole('tab', { name: 'Access' }).click();
    await page.waitForTimeout(1000);

    // The access workspace should load its admin and viewer controls.
    await expect(page.getByRole('button', { name: 'Add Admin' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Viewers' })).toBeVisible();
  });

  test('share links tab loads', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await page.click('role=tab[name="Share Links"]');
    await page.waitForTimeout(1000);

    // Should show create link button or existing links
    await expect(page.getByRole('button', { name: 'Create Link' }).first()).toBeVisible();
  });
});

test.describe('Room Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('room settings page loads with current values', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await page.goto(`${page.url()}/settings`);
    await page.waitForURL('**/settings', { timeout: 5000 });

    await expect(page.locator('input[id="name"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Danger Zone' })).toBeVisible();
  });
});
