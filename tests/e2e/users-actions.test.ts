/**
 * Users-table interaction regression.
 *
 * A real browser must remain able to edit a member and open their secondary
 * actions after the save refreshes the table. This protects the Radix
 * menu/dialog focus boundary that a DOM-only test cannot fully emulate.
 */
import { test, expect } from '@playwright/test';

const MEMBER_NAME = 'Alice Investor';
const UPDATED_FIRST_NAME = 'Alice Action Test';

test.describe('Users table actions', () => {
  test.use({ storageState: 'tests/e2e/.auth/admin.json' });

  test('remain usable after editing and saving a member', async ({ page }) => {
    await page.goto('/users');

    const editMember = page.getByRole('button', { name: `Edit ${MEMBER_NAME}` });
    await expect(editMember).toBeVisible({ timeout: 15000 });
    await editMember.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Organization profile & compliance')).toBeVisible();
    await expect(dialog.getByLabel('Company')).toBeVisible();
    await expect(dialog.getByLabel('Executed NDA on file')).toBeVisible();
    await dialog.getByLabel('First name').fill(UPDATED_FIRST_NAME);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).not.toBeVisible();

    const updatedMemberName = `${UPDATED_FIRST_NAME} Investor`;
    const updatedEdit = page.getByRole('button', { name: `Edit ${updatedMemberName}` });
    await expect(updatedEdit).toBeVisible({ timeout: 10000 });
    await updatedEdit.click();
    await expect(dialog).toBeVisible();

    // Restore the seeded member so later E2E tests see their normal fixture.
    await dialog.getByLabel('First name').fill('Alice');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).not.toBeVisible();

    const moreActions = page.getByRole('button', { name: `More actions for ${MEMBER_NAME}` });
    await expect(moreActions).toBeVisible({ timeout: 10000 });
    await moreActions.click();
    await expect(page.getByRole('menuitem', { name: 'Send Email' })).toBeVisible();
  });
});
