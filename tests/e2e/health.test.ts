/**
 * Health Check E2E Tests
 *
 * Tests the API health endpoint.
 */

import { test, expect } from '@playwright/test';

test.describe('Health API', () => {
  test('should return healthy status', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('should include version info', async ({ request }) => {
    const response = await request.get('/api/health');
    const body = await response.json();

    expect(body.version).toBeDefined();
  });
});
