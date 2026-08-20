import { test, expect } from '@playwright/test';

test.describe('Live Staging SysOp Security & IP Allowlist E2E Suite', () => {
  test('executes full E2E browser authentication and SysOp security workflow', async ({ page }) => {
    // 1. Authenticate as Platform Operator
    await page.goto('/auth/login');
    await page.fill('input[type="email"], input[name="email"]', 'admin@acme.example');
    await page.fill('input[type="password"], input[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Wait for authentication redirect
    await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15000 });

    // 2. Navigate to SysOp Security Control Panel
    await page.goto('/sysop/security');
    await expect(page.locator('h1')).toContainText('SysOp Security & In-App IP Allowlist');

    // 3. Verify Active Client IP recognition
    const clientIpText = page.locator('p', { hasText: /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/ });
    await expect(clientIpText).toBeVisible();

    const authorizedBadge = page.locator('text=IP Matched & Authorized');
    await expect(authorizedBadge).toBeVisible();

    // 4. Test Add CIDR Entry Modal Flow
    await page.click('button:has-text("Add IP / CIDR")');
    await page.fill('input[placeholder*="203.0.113"]', '198.51.100.0/24');
    await page.fill('input[placeholder*="Corporate HQ"]', 'Playwright E2E Subnet');
    await page.click('button:has-text("Add to Allowlist")');

    // Verify row added to allowlist table
    await expect(page.locator('td', { hasText: '198.51.100.0/24' })).toBeVisible();
    await expect(page.locator('td', { hasText: 'Playwright E2E Subnet' })).toBeVisible();

    // 5. Test Remove CIDR Entry Flow
    const removeBtn = page.locator('tr', { hasText: '198.51.100.0/24' }).locator('button', { hasText: 'Remove' });
    await removeBtn.click();
    await expect(page.locator('td', { hasText: '198.51.100.0/24' })).not.toBeVisible();

    // 6. Test Self-Lockout Prevention Guard
    // Ensure active client IP is not in allowlist, then click Enable Enforcement
    await page.click('button:has-text("Enable Enforcement")');
    const lockoutAlert = page.locator('text=Lockout prevented');
    await expect(lockoutAlert).toBeVisible();

    // 7. Verify SysOp Overview Infrastructure Payload Redaction
    const overviewRes = await page.request.get('/api/sysop/overview');
    expect(overviewRes.status()).toBe(200);
    const overviewJson = await overviewRes.json();
    expect(overviewJson.infrastructure.environment).toBe('Azure Staging');
    expect(overviewJson.infrastructure.status).toBe('HEALTHY');
    expect(overviewJson.infrastructure.subscription).toBeUndefined();
    expect(overviewJson.infrastructure.databaseHost).toBeUndefined();
    expect(overviewJson.infrastructure.vmHost).toBeUndefined();
  });
});
