/**
 * Accessibility (WCAG 2.1 AA) smoke tests.
 *
 * Uses @axe-core/playwright to scan key public-facing pages for accessibility
 * violations. Fails the test if any violation matching WCAG 2.1 A or AA is
 * found. Initially scoped to unauthenticated surfaces; expand to authenticated
 * pages once a login fixture is in place.
 *
 * Run against staging:
 *   PLAYWRIGHT_BASE_URL=https://ca-vaultspace-web.victoriousglacier-374689f2.eastus.azurecontainerapps.io \
 *     PLAYWRIGHT_WEB_SERVER_COMMAND= npx playwright test tests/e2e/a11y.test.ts
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const PUBLIC_PAGES: Array<{ name: string; path: string }> = [
  { name: 'Landing', path: '/' },
  { name: 'Login', path: '/auth/login' },
  { name: 'Register', path: '/auth/register' },
  { name: 'Forgot Password', path: '/auth/forgot-password' },
];

const AUTHENTICATED_PAGES: Array<{ name: string; path: string }> = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Rooms List', path: '/rooms' },
  { name: 'Users', path: '/users' },
  { name: 'Groups', path: '/groups' },
  { name: 'Activity', path: '/activity' },
  { name: 'Settings', path: '/settings' },
  { name: 'Settings Organization', path: '/settings/organization' },
  { name: 'Settings Notifications', path: '/settings/notifications' },
];

function summarize(
  violations: Array<{ impact?: string | null; id: string; nodes: unknown[]; help: string }>
) {
  return violations
    .map(
      (v) =>
        `  - ${v.impact}: ${v.id} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'}) — ${v.help}`
    )
    .join('\n');
}

test.describe('WCAG 2.1 AA smoke tests — public pages', () => {
  for (const page of PUBLIC_PAGES) {
    test(`${page.name} page has no critical accessibility violations`, async ({ page: pwPage }) => {
      await pwPage.goto(page.path);
      await pwPage.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page: pwPage }).withTags(TAGS).analyze();

      if (results.violations.length > 0) {
        console.log(`Violations on ${page.name}:\n${summarize(results.violations)}`);
      }

      expect(results.violations).toEqual([]);
    });
  }
});

test.describe('WCAG 2.1 AA smoke tests — authenticated pages', () => {
  test.use({ storageState: 'tests/e2e/.auth/admin.json' });

  for (const page of AUTHENTICATED_PAGES) {
    test(`${page.name} page has no critical accessibility violations`, async ({ page: pwPage }) => {
      await pwPage.goto(page.path);
      await pwPage.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page: pwPage }).withTags(TAGS).analyze();

      if (results.violations.length > 0) {
        console.log(`Violations on ${page.name}:\n${summarize(results.violations)}`);
      }

      expect(results.violations).toEqual([]);
    });
  }
});
