/**
 * Regression for #93: a viewer opening a document from a nested folder must
 * return to that folder when using the document viewer's Back control.
 */
import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ADMIN_STORAGE_STATE = 'tests/e2e/.auth/admin.json';

async function readAdminSessionCookie(): Promise<string> {
  const state = JSON.parse(await readFile(ADMIN_STORAGE_STATE, 'utf8')) as {
    cookies?: Array<{ name?: string; value?: string }>;
  };
  const session = state.cookies?.find((cookie) => cookie.name === 'vaultspace-session');
  if (!session?.value) {
    throw new Error('Authenticated Playwright storage state does not contain a VaultSpace session');
  }
  return `${session.name}=${session.value}`;
}

async function accessViewer(page: Page, shareToken: string, email: string): Promise<void> {
  await page.goto(`/view/${shareToken}`);
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Access Data Room' }).click();
  await page.waitForURL(`**/view/${shareToken}/documents`);
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).some((cookie) => cookie.name === `viewer_${shareToken}`),
      { timeout: 5_000 }
    )
    .toBe(true);
}

async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('Viewer folder navigation', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  let adminCookie = '';
  let roomId = '';
  let linkId = '';
  let linkSlug = '';

  test.beforeAll(async ({ request }) => {
    adminCookie = await readAdminSessionCookie();

    const roomsResponse = await request.get('/api/rooms', {
      headers: { Cookie: adminCookie },
    });
    expect(roomsResponse.ok()).toBe(true);
    const roomsBody = await roomsResponse.json();
    const room = (roomsBody.rooms as Array<{ id: string; name: string }>).find(
      (candidate) => candidate.name === 'Due Diligence Package'
    );
    expect(room).toBeTruthy();
    roomId = room!.id;

    const linkResponse = await request.post(`/api/rooms/${roomId}/links`, {
      headers: { Cookie: adminCookie },
      data: {
        name: `E2E viewer navigation ${Date.now()}`,
        permission: 'VIEW',
        scope: 'ENTIRE_ROOM',
        requiresEmailVerification: true,
      },
    });
    expect(linkResponse.ok()).toBe(true);
    const linkBody = await linkResponse.json();
    linkId = linkBody.link.id;
    linkSlug = linkBody.link.slug;
  });

  test.afterAll(async ({ request }) => {
    if (linkId && roomId) {
      await request.delete(`/api/rooms/${roomId}/links/${linkId}`, {
        headers: { Cookie: adminCookie },
      });
    }
  });

  test('Back returns to the originating folder', async ({ page }) => {
    await accessViewer(page, linkSlug, `viewer-navigation-back-${Date.now()}@test.local`);

    await page.getByText('Financials', { exact: true }).click();
    await expect(page).toHaveURL(/\/documents\?folderId=/);
    await expect(page.getByText('Capitalization Table.xlsx', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'View Capitalization Table.xlsx' }).click();
    await expect(page).toHaveURL(/\/documents\/[^?]+\?folderId=/);

    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page).toHaveURL(/\/documents\?folderId=/);
    await expect(page.getByText('Capitalization Table.xlsx', { exact: true })).toBeVisible();
    await expect(page.getByText('Financials', { exact: true })).toBeVisible();
  });

  test('stale folder context safely falls back to the room root', async ({ page }) => {
    await accessViewer(page, linkSlug, `viewer-navigation-stale-${Date.now()}@test.local`);

    const staleContextResponse = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return { status: response.status, body: await response.json() };
    }, `/api/view/${linkSlug}/documents?folderId=not-an-accessible-folder`);
    expect(staleContextResponse.status).toBe(200);
    expect(staleContextResponse.body.folderContextId).toBeNull();

    await page.goto(`/view/${linkSlug}/documents?folderId=not-an-accessible-folder`);
    await expect(page).toHaveURL(new RegExp(`/view/${linkSlug}/documents$`));
    await expect(page.getByRole('button', { name: 'Go to root folder' })).toBeVisible();
    await expect(page.getByText('Financials', { exact: true })).toBeVisible();
  });

  test('external viewer documents meet the WCAG 2.1 A and AA automated gate', async ({ page }) => {
    await accessViewer(page, linkSlug, `viewer-navigation-a11y-${Date.now()}@test.local`);
    await expectNoA11yViolations(page);

    await page.getByText('Financials', { exact: true }).click();
    await expect(page.getByText('Capitalization Table.xlsx', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View Capitalization Table.xlsx' }).click();
    await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
