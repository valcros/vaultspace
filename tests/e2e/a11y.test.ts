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

const PUBLIC_PAGES: Array<{ name: string; path: string }> = [
  { name: 'Landing', path: '/' },
  { name: 'Login', path: '/auth/login' },
  { name: 'Register', path: '/auth/register' },
  { name: 'Forgot Password', path: '/auth/forgot-password' },
];

test.describe('WCAG 2.1 AA smoke tests', () => {
  for (const page of PUBLIC_PAGES) {
    test(`${page.name} page has no critical accessibility violations`, async ({ page: pwPage }) => {
      await pwPage.goto(page.path);
      await pwPage.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page: pwPage })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Print a compact summary so the test report shows what we scanned.
      const violationSummary = results.violations
        .map(
          (v) =>
            `  - ${v.impact}: ${v.id} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'}) — ${v.help}`
        )
        .join('\n');
      if (results.violations.length > 0) {
        console.log(`Violations on ${page.name}:\n${violationSummary}`);
      }

      expect(results.violations).toEqual([]);
    });
  }
});
