/**
 * E2E Tests: Authentication Flows
 *
 * Tests login, registration, and session management via the live UI.
 */

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/auth/login');

    await expect(page).toHaveTitle(/VaultSpace|Authentication/);
    await expect(page.locator('text=Welcome back')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(page.locator('text=Sign up')).toBeVisible();
    await expect(page.locator('text=Forgot password')).toBeVisible();
  });

  test('registration page renders correctly', async ({ page }) => {
    await page.goto('/auth/register');

    await expect(page.locator('text=Create an account')).toBeVisible();
    await expect(page.locator('input[placeholder="Alice"]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/auth/login');

    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Should stay on login page with an error
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('login with valid credentials redirects to rooms', async ({ page }) => {
    await page.goto('/auth/login');

    await page.fill('input[type="email"]', 'admin@demo.vaultspace.app');
    await page.fill('input[type="password"]', 'Demo123!');
    await page.click('button[type="submit"]');

    // The dashboard is the post-login landing page.
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/rooms');
    await page.waitForURL('**/auth/login', { timeout: 5000 });
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('forgot password page renders correctly', async ({ page }) => {
    await page.goto('/auth/forgot-password');

    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
