/**
 * E2E Tests: Room Interactions
 *
 * Safety net for the room-page decomposition (audit finding 4): pins the
 * behaviors that must survive extraction — folder navigation, document
 * preview, ?doc= and ?manage= deep links, the manage drawer panes, the
 * upload dialog, and list-view selection.
 *
 * Requires demo seed data (admin@demo.vaultspace.app / Demo123!):
 * room "Due Diligence Package" with folders Financials/Legal/Technical and
 * root document "Pitch Deck.pptx".
 */

import { test, expect, Page } from '@playwright/test';

const ROOM_NAME = 'Due Diligence Package';
const ROOT_DOCUMENT = 'Pitch Deck.pptx';

async function loginAsAdmin(page: Page) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', 'admin@demo.vaultspace.app');
  await page.fill('input[type="password"]', 'Demo123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

async function findRoomId(page: Page): Promise<string> {
  const res = await page.request.get('/api/rooms');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const room = body.rooms.find((r: { name: string }) => r.name === ROOM_NAME);
  expect(room, `seed room "${ROOM_NAME}" must exist`).toBeTruthy();
  return room.id;
}

test.describe('Room interactions', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('folder tiles navigate and update the breadcrumb', async ({ page }) => {
    const roomId = await findRoomId(page);
    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByRole('button', { name: /Financials/ })).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole('button', { name: /Financials/ }).click();
    await expect(page.getByText('Capitalization Table.xlsx')).toBeVisible({ timeout: 10000 });
    // Folder breadcrumb marks the current folder
    await expect(page.getByRole('navigation', { name: 'Folder path' })).toContainText('Financials');
  });

  test('clicking a document opens and closes the preview dialog', async ({ page }) => {
    const roomId = await findRoomId(page);
    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByText(ROOT_DOCUMENT)).toBeVisible({ timeout: 15000 });

    await page.getByText(ROOT_DOCUMENT).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog).toContainText(ROOT_DOCUMENT);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('?doc= deep link opens the preview directly', async ({ page }) => {
    const roomId = await findRoomId(page);
    const docsRes = await page.request.get(`/api/rooms/${roomId}/documents`);
    expect(docsRes.ok()).toBeTruthy();
    const docs = (await docsRes.json()).documents as { id: string; name: string }[];
    const target = docs.find((d) => d.name === ROOT_DOCUMENT);
    expect(target, `seed document "${ROOT_DOCUMENT}" must exist at room root`).toBeTruthy();

    await page.goto(`/rooms/${roomId}?doc=${target!.id}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog).toContainText(ROOT_DOCUMENT);
  });

  test('?manage= deep link opens the drawer on the requested pane', async ({ page }) => {
    const roomId = await findRoomId(page);
    await page.goto(`/rooms/${roomId}?manage=qa`);

    await expect(page.getByRole('tablist', { name: 'Room management sections' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('tab', { name: 'Q&A' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Manage button opens the drawer; pane tabs switch', async ({ page }) => {
    const roomId = await findRoomId(page);
    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByRole('button', { name: 'Manage' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Manage' }).click();
    const tablist = page.getByRole('tablist', { name: 'Room management sections' });
    await expect(tablist).toBeVisible({ timeout: 10000 });
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

  test('Upload Files opens the upload dialog', async ({ page }) => {
    const roomId = await findRoomId(page);
    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByRole('button', { name: 'Upload Files' })).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole('button', { name: 'Upload Files' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog).toContainText('Upload Files');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('list view shows the documents table with selection', async ({ page }) => {
    const roomId = await findRoomId(page);
    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByRole('button', { name: 'List view' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'List view' }).click();
    await expect(page.getByText(ROOT_DOCUMENT)).toBeVisible({ timeout: 10000 });

    // Selection is rendered as icon buttons (CheckSquare/Square), not
    // checkbox roles; the accessible name flips when selection fills.
    const selectAll = page.getByRole('button', { name: 'Select all' });
    await expect(selectAll).toBeVisible();
    await selectAll.click();
    await expect(page.getByRole('button', { name: 'Deselect all' })).toBeVisible();
  });

  test('breadcrumb links navigate (regression: hidden dock swallowed clicks)', async ({ page }) => {
    // QA-reported: the auto-hidden floating dock lost its anchor classes,
    // re-anchored invisibly over the breadcrumb, and ate these clicks
    // (Home appeared to open Messages; Rooms did nothing). Playwright's
    // actionability checks time out if anything covers the link.
    const roomId = await findRoomId(page);
    await page.goto(`/rooms/${roomId}`);
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });

    await breadcrumb.getByRole('link', { name: 'Rooms' }).click();
    await page.waitForURL('**/rooms', { timeout: 10000 });

    await page.goto(`/rooms/${roomId}`);
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });
    await breadcrumb.getByRole('link', { name: 'Home' }).click();
    await page.waitForURL('**/dashboard', { timeout: 10000 });
  });

  test('folder pane is available in grid view', async ({ page }) => {
    const roomId = await findRoomId(page);
    await page.goto(`/rooms/${roomId}`);
    // Grid is the first-visit default; the pane toggle must exist here too
    // (QA request: the rail was list-only).
    await expect(page.getByRole('button', { name: /folder pane/ })).toBeVisible({
      timeout: 15000,
    });

    const expand = page.getByRole('button', { name: 'Expand folder pane' });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }
    const rail = page.getByRole('complementary', { name: 'Folder navigation' });
    await expect(rail).toBeVisible({ timeout: 10000 });
    await expect(rail.getByText('Financials')).toBeVisible();
  });
});
