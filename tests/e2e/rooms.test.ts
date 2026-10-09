/**
 * E2E Tests: Room Management
 *
 * Tests room CRUD operations via the live UI.
 * Requires demo seed data (admin@demo.vaultspace.app / Demo123!).
 */

import { test, expect } from '@playwright/test';

// The auth-setup project owns the browser login flow and persists this state.
// Reusing it is both faster and more representative of an established admin
// session; repeated UI logins were intermittently timing out in CI WebKit.
const ADMIN_STORAGE_STATE = 'tests/e2e/.auth/admin.json';
test.use({ storageState: ADMIN_STORAGE_STATE });

async function openRooms(page: import('@playwright/test').Page) {
  await page.goto('/rooms');
  await page.waitForURL('**/rooms', { timeout: 10000 });
}

test.describe('Room Management', () => {
  test.beforeEach(async ({ page }) => {
    await openRooms(page);
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
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByText('Draft room - Not Published - Admin Only', { exact: true })
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
    await expect(
      page.getByText(/Prepare folders and documents while this room is in Draft/)
    ).toBeVisible();
    const roomId = new URL(page.url()).pathname.split('/').pop();
    expect(roomId).toBeTruthy();
    await page.goto(`/rooms/${roomId}/settings`);
    await expect(
      page.getByText('Draft room - Not Published - Admin Only', { exact: true })
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );

    await page.goto('/rooms');
    const draftCard = page.getByRole('link', { name: new RegExp(roomName) });
    await expect(draftCard).toContainText('Draft room - Not Published - Admin Only');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
    await expect(draftCard.getByRole('button', { name: 'Actions' })).toBeVisible();

    // The menu click itself is exercised in the isolated production browser
    // verification. Use the same authenticated browser context for the
    // lifecycle request here so the seeded cross-browser CI suite does not
    // spend retries on nested interactive elements inside the card link.
    const publishResponse = await page.request.patch(`/api/rooms/${roomId}`, {
      data: { status: 'ACTIVE' },
    });
    expect(publishResponse.status()).toBe(200);

    await page.goto('/rooms');

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
    await openRooms(page);
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

test.describe('Room contextual help', () => {
  test('status help supports hover, keyboard, and dismissal without navigation', async ({
    page,
  }) => {
    await openRooms(page);
    const help = page.getByRole('button', {
      name: 'About room status: Due Diligence Package',
      exact: true,
    });
    await help.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('people with permission');
    // Move onto the visible tooltip content, not Radix's screen-reader duplicate.
    await page.locator('[data-radix-popper-content-wrapper]').last().hover();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(0, 0);
    await help.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Enter');
    const detail = page.getByRole('dialog', {
      name: 'About room status: Due Diligence Package',
      exact: true,
    });
    await expect(detail).toContainText('does not make the room public to everyone');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await help.click();
    await expect(detail).toBeVisible();
    await page.getByRole('heading', { name: 'Data Rooms', exact: true }).click();
    await expect(detail).toHaveCount(0);
    await help.click();
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Close help' }).click();
    await expect(detail).toHaveCount(0);
    await expect(page).toHaveURL(/\/rooms$/);
  });

  test.describe('touch help and folder discovery', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('tap opens help and standard-folder selection remains optional', async ({ page }) => {
      await openRooms(page);
      const help = page.getByRole('button', {
        name: 'About room status: Due Diligence Package',
        exact: true,
      });
      await help.tap();
      const detail = page.getByRole('dialog', {
        name: 'About room status: Due Diligence Package',
        exact: true,
      });
      await expect(detail).toBeVisible();
      const bounds = await detail.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await detail.getByRole('button', { name: 'Close help' }).tap();
      await expect(detail).toHaveCount(0);
      await expect(page).toHaveURL(/\/rooms$/);
      await page.getByRole('link', { name: /Due Diligence Package/ }).tap();
      let folderWrites = 0;
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          /\/api\/rooms\/[^/]+\/folders(?:\/starter)?$/.test(new URL(request.url()).pathname)
        ) {
          folderWrites++;
        }
      });
      await page.getByRole('button', { name: 'Add folders', exact: true }).tap();
      const folders = page.getByRole('dialog');
      await expect(folders.getByLabel('Folder Name')).toBeVisible();
      await folders
        .getByRole('button', { name: 'Use a standard folder template', exact: true })
        .tap();
      await expect(folders.getByRole('button', { name: 'Add Selected Folders' })).toBeDisabled();
      await folders.getByRole('radio', { name: /Investor Data Room/ }).tap();
      await expect(folders.getByText('14 of 14 folders selected')).toBeVisible();
      await expect(folders.getByRole('button', { name: 'Add Selected Folders' })).toBeEnabled();
      await folders.getByRole('button', { name: 'Cancel', exact: true }).tap();
      await expect(folders).toHaveCount(0);
      expect(folderWrites).toBe(0);
    });
  });
});
