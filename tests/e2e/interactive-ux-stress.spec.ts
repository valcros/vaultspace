import { test, expect } from '@playwright/test';

test.describe('Interactive UX Stress & Focus Retention E2E Suite', () => {
  test('verifies rapid typing, focus retention, and layout persistence on Room Audit Trail search', async ({
    page,
  }) => {
    // 1. Authenticate as Admin
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'admin@acme.example');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15000 });

    // 2. Navigate directly to Room Audit page
    await page.goto('/rooms/cmmsaorov000b72gfv0eu97iw/audit');
    await expect(page.locator('h1')).toContainText('Audit Trail');

    // 3. Locate search input and click to focus
    const searchInput = page.locator('input[aria-label="Search room activity"]');
    await expect(searchInput).toBeVisible();
    await searchInput.click();

    // 4. Perform rapid keystroke typing test
    const testQuery = 'Document Uploaded Audit Search';
    for (const char of testQuery) {
      await searchInput.type(char, { delay: 50 }); // Simulate realistic 50ms rapid typing
      // Assert input element remains mounted and retains active focus throughout typing
      await expect(searchInput).toBeVisible();
      await expect(searchInput).toBeFocused();
    }

    // 5. Verify input value matches full typed string without losing focus or resetting
    await expect(searchInput).toHaveValue(testQuery);

    // 6. Verify layout header and filter controls remained mounted and stable
    await expect(page.locator('h1')).toContainText('Audit Trail');
    await expect(page.locator('button', { hasText: 'Export CSV' })).toBeVisible();
  });
});
