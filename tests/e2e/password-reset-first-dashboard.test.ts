import { randomBytes, randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { expect, test } from '@playwright/test';

import { createPasswordResetToken } from '../../src/lib/auth/passwordResetToken';
import {
  assertPasswordResetE2eEnvironment,
  PASSWORD_RESET_E2E_MARKER,
} from '../../scripts/password-reset-e2e-guard';

const { adminDatabaseUrl, baseUrl } = assertPasswordResetE2eEnvironment();
const db = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl.toString() } } });
const fixtureId = randomUUID().replaceAll('-', '');
const fixtureEmail = `password-reset-e2e-${fixtureId}@example.test`;
const initialPassword = `initial-${randomBytes(18).toString('base64url')}`;
const replacementPassword = `replacement-${randomBytes(18).toString('base64url')}`;
const organizationSlug = `password-reset-e2e-${fixtureId.slice(0, 24)}`;
let resetToken: string | undefined;

test.beforeAll(async () => {
  await db.$connect();
  const [marker] = await db.$queryRaw<Array<{ marker: string }>>`
    SELECT marker FROM password_reset_e2e_test_marker
    WHERE marker = ${PASSWORD_RESET_E2E_MARKER}`;
  expect(marker?.marker).toBe(PASSWORD_RESET_E2E_MARKER);

  const organization = await db.organization.create({
    data: {
      name: 'Password Reset Browser E2E',
      slug: organizationSlug,
      isActive: true,
      allowSelfSignup: false,
    },
  });
  const user = await db.user.create({
    data: {
      email: fixtureEmail,
      passwordHash: await bcrypt.hash(initialPassword, 12),
      firstName: 'Password',
      lastName: 'Reset E2E',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });
  await db.userOrganization.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role: 'VIEWER',
      isActive: true,
    },
  });
  const tokenPair = createPasswordResetToken();
  resetToken = tokenPair.publicToken;
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      token: tokenPair.storedToken,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      organizationId: organization.id,
      auditOrganizationIds: [organization.id],
    },
  });
});

test.afterAll(async () => {
  // Successful reset redemption writes append-only audit evidence. The outer
  // disposable-database lifecycle, not this test, owns its removal.
  await db.$disconnect();
});

test('redeems a real reset then renders the first authenticated dashboard without a refresh', async ({
  page,
  context,
}) => {
  if (!resetToken) {
    throw new Error('Password-reset browser fixture was not initialized');
  }
  try {
    await context.addInitScript(
      ({ token, resetPath }) => {
        if (window.location.pathname === resetPath) {
          window.location.hash = `token=${token}`;
        }
      },
      { token: resetToken, resetPath: '/auth/reset-password' }
    );
  } catch {
    throw new Error('Password-reset browser capability installation failed');
  }
  await page.goto('/auth/reset-password');
  await expect(page.locator('#password')).toBeVisible();
  expect(await page.evaluate(() => !window.location.href.includes('token='))).toBe(true);

  await page.locator('#password').fill(replacementPassword);
  await page.locator('#confirmPassword').fill(replacementPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'Password Reset' })).toBeVisible();
  await page.waitForURL(/\/auth\/login$/, { timeout: 10_000 });
  expect(await page.evaluate(() => !window.location.href.includes('token='))).toBe(true);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const unhealthyResponses: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push('console-error');
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (
      url.origin !== baseUrl.origin ||
      !(pathname === '/dashboard' || pathname.startsWith('/api/'))
    ) {
      return;
    }
    const reason = request.failure()?.errorText ?? 'unknown';
    // A superseded or canceled navigation reports net::ERR_ABORTED. That is a
    // cancellation, not a transport failure: the successful first-load
    // navigation is asserted separately (200 document, greeting rendered,
    // /api/auth/me 200, no refresh), so an aborted duplicate cannot be the
    // reported "page-load error until manual refresh" regression. Record it for
    // the run artifact but do not count it. Every other reason (connection
    // refused/reset, empty response, timeout) is kept as a genuine failure.
    if (reason === 'net::ERR_ABORTED') {
      // eslint-disable-next-line no-console
      console.log(
        `[password-reset-e2e] ignored aborted request ${pathname} ` +
          `navigation=${request.isNavigationRequest()} type=${request.resourceType()} ${reason}`
      );
      return;
    }
    failedRequests.push(`${pathname} ${reason}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.origin === baseUrl.origin &&
      (url.pathname === '/dashboard' || url.pathname.startsWith('/api/')) &&
      (response.status() === 401 || response.status() === 403 || response.status() >= 500)
    ) {
      unhealthyResponses.push(`${url.pathname}:${response.status()}`);
    }
  });

  const dashboardDocument = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/dashboard' && response.request().isNavigationRequest(),
    { timeout: 15_000 }
  );
  await page.locator('input[type="email"]').fill(fixtureEmail);
  await page.locator('input[type="password"]').fill(replacementPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await dashboardDocument).status()).toBe(200);
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  expect(await page.evaluate(() => !window.location.href.includes('token='))).toBe(true);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible(
    { timeout: 10_000 }
  );
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByText(/This page couldn.t load/i)).toHaveCount(0);
  expect(
    await page.evaluate(async () => (await fetch('/api/auth/me', { cache: 'no-store' })).status)
  ).toBe(200);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(unhealthyResponses).toEqual([]);
});
