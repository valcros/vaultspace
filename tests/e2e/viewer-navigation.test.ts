/**
 * Regression for #93: a viewer opening a document from a nested folder must
 * return to that folder when using the document viewer's Back control.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

const ADMIN_EMAIL = process.env['PLAYWRIGHT_ADMIN_EMAIL'] || 'admin@demo.vaultspace.app';
const ADMIN_PASSWORD = process.env['PLAYWRIGHT_ADMIN_PASSWORD'] || 'Demo123!';

async function loginAsAdmin(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  return response.headers()['set-cookie'] ?? '';
}

test.describe('Viewer folder navigation', () => {
  let adminCookie = '';
  let roomId = '';
  let linkId = '';
  let linkSlug = '';

  test.beforeAll(async ({ request }) => {
    adminCookie = await loginAsAdmin(request);

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
    await page.goto(`/view/${linkSlug}`);
    await page.getByLabel('Email Address').fill('viewer-navigation@test.local');
    await page.getByRole('button', { name: 'Access Data Room' }).click();
    await page.waitForURL(`**/view/${linkSlug}/documents`);

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
});
