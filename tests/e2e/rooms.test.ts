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

  test('room detail page shows seeded content and management sections', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await expect(page.getByRole('heading', { name: 'Due Diligence Package' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage' })).toBeVisible();

    // Folder tiles are buttons in the current grid layout, with their file
    // count included in the accessible name.
    await expect(page.getByRole('button', { name: /Financials \d+ files/ })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: /Legal \d+ files/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Technical \d+ files/ })).toBeVisible();

    // Access and Share Links now live in the room-management drawer.
    await page.getByRole('button', { name: 'Manage' }).click();
    const managementTabs = page.getByRole('tablist', { name: 'Room management sections' });
    await expect(managementTabs).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: 'Access' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.getByRole('tab', { name: 'Share Links' }).click();
    await expect(page.getByRole('tab', { name: 'Share Links' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('can navigate into folders', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    const financialsTile = page.getByRole('button', { name: /Financials \d+ files/ });
    await expect(financialsTile).toBeVisible({ timeout: 15000 });
    await financialsTile.click();

    await expect(page.getByRole('navigation', { name: 'Folder path' })).toContainText('Financials');
    await expect(page.getByText('Capitalization Table.xlsx')).toBeVisible({ timeout: 10000 });
  });

  test('Access management section loads', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await page.getByRole('button', { name: 'Manage' }).click();
    await expect(page.getByRole('tablist', { name: 'Room management sections' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('tab', { name: 'Access' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // The access workspace should load its admin and viewer controls.
    await expect(page.getByRole('button', { name: 'Add Admin' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Viewers' })).toBeVisible();
  });

  test('Share Links management section loads', async ({ page }) => {
    await page.click('text=Due Diligence Package');
    await page.waitForURL('**/rooms/**', { timeout: 5000 });

    await page.getByRole('button', { name: 'Manage' }).click();
    await expect(page.getByRole('tablist', { name: 'Room management sections' })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('tab', { name: 'Share Links' }).click();
    await expect(page.getByRole('tab', { name: 'Share Links' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // The section must expose its primary action, not merely select the tab.
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
