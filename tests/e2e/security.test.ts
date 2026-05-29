/**
 * E2E Security Tests: SEC-010 and SEC-012
 *
 * SEC-010: Expired link returns 410 Gone (GET and POST)
 * SEC-012: Password-protected link requires correct password
 *
 * These tests run against a live server. They create and clean up their own
 * test data so they can run safely against any seeded environment.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const ADMIN_EMAIL = process.env['PLAYWRIGHT_ADMIN_EMAIL'] || 'admin@demo.vaultspace.app';
const ADMIN_PASSWORD = process.env['PLAYWRIGHT_ADMIN_PASSWORD'] || 'Demo123!';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAsAdmin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Admin login failed: ${res.status()}`).toBe(true);
  return res.headers()['set-cookie'] ?? '';
}

async function getFirstRoomId(request: APIRequestContext, cookie: string): Promise<string | null> {
  const res = await request.get('/api/rooms', {
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (!res.ok()) return null;
  const body = await res.json();
  return (body.rooms as Array<{ id: string }>)?.[0]?.id ?? null;
}

async function createLink(
  request: APIRequestContext,
  cookie: string,
  roomId: string,
  payload: Record<string, unknown>
): Promise<{ id: string; slug: string } | null> {
  const res = await request.post(`/api/rooms/${roomId}/links`, {
    headers: { Cookie: cookie },
    data: payload,
  });
  if (!res.ok()) return null;
  const body = await res.json();
  return body.link as { id: string; slug: string };
}

async function deleteLink(
  request: APIRequestContext,
  cookie: string,
  roomId: string,
  linkId: string
) {
  await request.delete(`/api/rooms/${roomId}/links/${linkId}`, {
    headers: { Cookie: cookie },
  });
}

// ---------------------------------------------------------------------------
// SEC-010: Expired link returns 410 Gone
// ---------------------------------------------------------------------------

test.describe('SEC-010: Expired link returns 410', () => {
  let cookie = '';
  let roomId = '';
  let linkId = '';
  let linkSlug = '';

  test.beforeAll(async ({ request }) => {
    cookie = await loginAsAdmin(request);
    const id = await getFirstRoomId(request, cookie);
    if (!id) {
      test.skip();
      return;
    }
    roomId = id;

    // Set expiresAt to 24 hours in the past
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const link = await createLink(request, cookie, roomId, {
      name: 'SEC-010 E2E Test Link',
      expiresAt,
    });
    if (!link) {
      test.skip();
      return;
    }
    linkId = link.id;
    linkSlug = link.slug;
  });

  test.afterAll(async ({ request }) => {
    if (linkId && roomId) {
      await deleteLink(request, cookie, roomId, linkId);
    }
  });

  test('GET expired link returns 410 Gone', async ({ request }) => {
    const res = await request.get(`/api/links/${linkSlug}`);
    expect(res.status()).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/expir/i);
  });

  test('POST to expired link returns 410 Gone', async ({ request }) => {
    const res = await request.post(`/api/links/${linkSlug}`, {
      data: { email: 'viewer@example.com' },
    });
    expect(res.status()).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/expir/i);
  });
});

// ---------------------------------------------------------------------------
// SEC-012: Password-protected link requires correct password
// ---------------------------------------------------------------------------

test.describe('SEC-012: Password-protected link access', () => {
  let cookie = '';
  let roomId = '';
  let linkId = '';
  let linkSlug = '';
  const TEST_PASSWORD = 'Sec012Test!';

  test.beforeAll(async ({ request }) => {
    cookie = await loginAsAdmin(request);
    const id = await getFirstRoomId(request, cookie);
    if (!id) {
      test.skip();
      return;
    }
    roomId = id;

    const link = await createLink(request, cookie, roomId, {
      name: 'SEC-012 E2E Test Link',
      password: TEST_PASSWORD,
    });
    if (!link) {
      test.skip();
      return;
    }
    linkId = link.id;
    linkSlug = link.slug;
  });

  test.afterAll(async ({ request }) => {
    if (linkId && roomId) {
      await deleteLink(request, cookie, roomId, linkId);
    }
  });

  test('GET link info shows requiresPassword = true', async ({ request }) => {
    const res = await request.get(`/api/links/${linkSlug}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.link.requiresPassword).toBe(true);
  });

  test('POST without password returns 401', async ({ request }) => {
    const res = await request.post(`/api/links/${linkSlug}`, {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test('POST with wrong password returns 401', async ({ request }) => {
    const res = await request.post(`/api/links/${linkSlug}`, {
      data: { password: 'WrongPassword123!' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST with correct password returns 200', async ({ request }) => {
    const res = await request.post(`/api/links/${linkSlug}`, {
      data: { password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(200);
  });
});
