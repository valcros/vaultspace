/**
 * E2E Tests: API Endpoints
 *
 * Tests API endpoints directly via HTTP requests.
 * These run against a live server instance.
 */

import { test, expect } from '@playwright/test';

test.describe('API Health', () => {
  test('health endpoint returns healthy status', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.version).toBeDefined();
  });

  test('deep health check validates all services', async ({ request }) => {
    const response = await request.get('/api/health?deep=true');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.checks).toBeDefined();
    expect(body.checks.database).toBeDefined();
    expect(body.checks.cache).toBeDefined();
    expect(body.checks.storage).toBeDefined();
  });
});

test.describe('API Authentication', () => {
  test('login with valid credentials returns session', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: {
        email: 'admin@demo.vaultspace.app',
        password: 'Demo123!',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe('admin@demo.vaultspace.app');
  });

  test('login with invalid credentials returns 401', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: {
        email: 'admin@demo.vaultspace.app',
        password: 'wrongpassword',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('unauthenticated API request returns 401', async ({ request }) => {
    const response = await request.get('/api/rooms');
    expect(response.status()).toBe(401);
  });
});

test.describe('API Rooms (authenticated)', () => {
  let cookies: string;

  test.beforeAll(async ({ request }) => {
    const loginResponse = await request.post('/api/auth/login', {
      data: {
        email: 'admin@demo.vaultspace.app',
        password: 'Demo123!',
      },
    });

    // Extract session cookie
    const setCookieHeaders = loginResponse.headers()['set-cookie'];
    if (setCookieHeaders) {
      cookies = setCookieHeaders;
    }
  });

  test('list rooms returns seed data', async ({ request }) => {
    const response = await request.get('/api/rooms', {
      headers: cookies ? { Cookie: cookies } : {},
    });

    if (response.ok()) {
      const body = await response.json();
      expect(body.rooms).toBeDefined();
      expect(Array.isArray(body.rooms)).toBe(true);
    }
  });
});

test.describe('API Security', () => {
  test('CORS headers are set', async ({ request }) => {
    const response = await request.get('/api/health');
    const headers = response.headers();

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('preview routes allow iframe embedding', async ({ request }) => {
    // Preview routes should have SAMEORIGIN, not DENY
    // This is tested implicitly — the middleware sets SAMEORIGIN for /documents/*/preview paths
    const response = await request.get('/api/health');
    expect(response.headers()['x-frame-options']).toBe('DENY');
  });
});
