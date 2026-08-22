/**
 * Notification-menu browser regression.
 *
 * This proves the header bell is a usable menu rather than a non-interactive
 * notification indicator, including keyboard dismissal.
 */
import { expect, test } from '@playwright/test';

test.describe('Notification menu', () => {
  test.use({ storageState: 'tests/e2e/.auth/admin.json' });

  test('opens from the bell and is keyboard dismissible', async ({ page }) => {
    await page.goto('/dashboard');

    const bell = page.getByRole('button', { name: /^Notifications(?:, \d+ unread)?$/ });
    await expect(bell).toBeVisible({ timeout: 15000 });
    await bell.click();

    await expect(page.getByRole('menu')).toContainText('Notifications');
    await expect(page.getByRole('link', { name: 'Notification preferences' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).not.toBeVisible();
  });
});
