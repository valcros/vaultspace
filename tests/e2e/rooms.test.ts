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

  test('admin can rediscover and publish a newly created draft room', async ({
    page,
  }, testInfo) => {
    // CI runs Chromium, Firefox, and WebKit against one seeded organization.
    // Include project and retry identity so each browser exercises the
    // lifecycle independently without violating the room-slug uniqueness key.
    const roomName = `Lifecycle Draft Verification ${testInfo.project.name} ${testInfo.retry}`;

    await page.getByRole('main').getByRole('button', { name: 'Create Room' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Data Room' });
    await dialog.getByLabel('Room Name').fill(roomName);
    await dialog.getByRole('button', { name: 'Create Room', exact: true }).click();
    await page.waitForURL('**/rooms/**', { timeout: 10000 });

    await page.goto('/rooms');
    await expect(page.getByRole('heading', { name: /Draft Rooms \(1\)/ })).toBeVisible();
    const draftCard = page.getByRole('link', { name: new RegExp(roomName) });
    await expect(draftCard).toContainText('Draft');

    await draftCard.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Publish room' }).click();
    const confirm = page.getByRole('dialog', { name: 'Publish room?' });
    await expect(confirm).toContainText('discoverable to authorized viewers');
    await confirm.getByRole('button', { name: 'Publish room' }).click();

    await expect(page.getByRole('heading', { name: /Active Rooms \(/ })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('link', { name: new RegExp(roomName) })).toContainText('Live room');
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
