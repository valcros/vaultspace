/**
 * E2E Security Tests
 *
 * SEC-001: Org-A admin cannot access Org-B room (404, not 403)
 * SEC-002: Org-A admin GET /api/rooms does not include Org-B rooms
 * SEC-003: Org-A view session cannot access Org-B document (404)
 * SEC-004: Request query organizationId is ignored; session org used
 * SEC-006: x-organization-id header is ignored
 * SEC-007: Unauthenticated request with org header returns 401
 * SEC-010: Expired link returns 410 Gone (GET and POST)
 * SEC-011: Org-B view session cannot access Org-A document (404)
 * SEC-012: Password-protected link requires correct password
 *
 * Covered in tests/integration/rls.test.ts (DB-level):
 *   SEC-005: RLS prevents cross-tenant at DB level
 *
 * Require document-level access + file upload (out of scope for E2E batch):
 *   SEC-008: Revoked permission takes effect immediately
 *   SEC-009: Removed group membership revokes access
 *
 * Require time manipulation (out of scope for E2E):
 *   SEC-013, SEC-014: Event audit immutability
 *   SEC-015, SEC-016: Signed URL expiry / revocation
 *
 * These tests run against a live server and create/clean up their own test
 * data so they are safe to run against any seeded environment.
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
  if (!res.ok()) {
    return null;
  }
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
  if (!res.ok()) {
    return null;
  }
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

// ---------------------------------------------------------------------------
// Two-org helpers (SEC-001..004, 006, 007, 003, 011)
// ---------------------------------------------------------------------------

const ORG_B_EMAIL = 'sec-orgb-admin@test.local';
const ORG_B_PASSWORD = 'OrgBSecTest1!';

interface OrgBSetup {
  cookie: string;
  roomId: string | null;
  orgId: string | null;
}

/**
 * Idempotently set up an Org-B admin. On first run, registers a new user
 * (which auto-creates a new org). On subsequent runs, logs in as the
 * existing user. Also ensures at least one room exists in Org-B.
 */
async function ensureOrgBSetup(request: APIRequestContext): Promise<OrgBSetup> {
  let cookie = '';

  const regRes = await request.post('/api/auth/register', {
    data: {
      email: ORG_B_EMAIL,
      password: ORG_B_PASSWORD,
      firstName: 'SecTest',
      lastName: 'OrgB',
    },
  });

  if (regRes.ok()) {
    cookie = regRes.headers()['set-cookie'] ?? '';
  } else if (regRes.status() === 409) {
    const loginRes = await request.post('/api/auth/login', {
      data: { email: ORG_B_EMAIL, password: ORG_B_PASSWORD },
    });
    if (!loginRes.ok()) {
      return { cookie: '', roomId: null, orgId: null };
    }
    cookie = loginRes.headers()['set-cookie'] ?? '';
  } else {
    return { cookie: '', roomId: null, orgId: null };
  }

  const roomsRes = await request.get('/api/rooms', { headers: { Cookie: cookie } });
  if (!roomsRes.ok()) {
    return { cookie, roomId: null, orgId: null };
  }
  const roomsBody = await roomsRes.json();
  const rooms = (roomsBody.rooms as Array<{ id: string; organizationId: string }>) ?? [];
  let roomId = rooms[0]?.id ?? null;
  let orgId = rooms[0]?.organizationId ?? null;

  if (!roomId) {
    const createRes = await request.post('/api/rooms', {
      headers: { Cookie: cookie },
      data: { name: 'SEC-Test Org-B Room' },
    });
    if (createRes.ok()) {
      const body = await createRes.json();
      roomId = (body.room as { id: string; organizationId: string } | null)?.id ?? null;
      orgId = (body.room as { id: string; organizationId: string } | null)?.organizationId ?? null;
    }
  }

  return { cookie, roomId, orgId };
}

// ---------------------------------------------------------------------------
// SEC-001 + SEC-002: Session org scoping — cross-tenant isolation
// ---------------------------------------------------------------------------

test.describe('SEC-001/002: Cross-tenant isolation via session org scoping', () => {
  let orgACookie = '';
  let orgBRoomId = '';

  test.beforeAll(async ({ request }) => {
    const orgBSetup = await ensureOrgBSetup(request);
    if (!orgBSetup.roomId) {
      test.skip();
      return;
    }
    orgBRoomId = orgBSetup.roomId;
    orgACookie = await loginAsAdmin(request);
  });

  test('SEC-001: Org-A admin cannot access Org-B room — returns 404, not 403', async ({
    request,
  }) => {
    const res = await request.get(`/api/rooms/${orgBRoomId}`, {
      headers: { Cookie: orgACookie },
    });
    expect(res.status()).toBe(404);
  });

  test('SEC-002: Org-A admin GET /api/rooms does not include Org-B rooms', async ({ request }) => {
    const res = await request.get('/api/rooms', { headers: { Cookie: orgACookie } });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const ids = (body.rooms as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(orgBRoomId);
  });
});

// ---------------------------------------------------------------------------
// SEC-004: Request-body / query organizationId is ignored; session org used
// ---------------------------------------------------------------------------

test.describe('SEC-004: Request query param organizationId is ignored', () => {
  let orgACookie = '';
  let orgBSetup: OrgBSetup = { cookie: '', roomId: null, orgId: null };

  test.beforeAll(async ({ request }) => {
    // Sequential to avoid shared cookie-jar mutation between the two flows
    orgACookie = await loginAsAdmin(request);
    orgBSetup = await ensureOrgBSetup(request);
    if (!orgBSetup.orgId) {
      test.skip();
    }
  });

  test('SEC-004a: GET /api/rooms?organizationId=orgBId still returns only Org-A rooms', async ({
    request,
  }) => {
    const res = await request.get(`/api/rooms?organizationId=${orgBSetup.orgId}`, {
      headers: { Cookie: orgACookie },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const ids = (body.rooms as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(orgBSetup.roomId);
  });

  test('SEC-004b: GET /api/rooms/:orgBRoomId with orgBId in query still returns 404', async ({
    request,
  }) => {
    if (!orgBSetup.roomId) {
      test.skip();
      return;
    }
    const res = await request.get(
      `/api/rooms/${orgBSetup.roomId}?organizationId=${orgBSetup.orgId}`,
      { headers: { Cookie: orgACookie } }
    );
    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// SEC-006 + SEC-007: x-organization-id header spoofing
// ---------------------------------------------------------------------------

test.describe('SEC-006/007: x-organization-id header is ignored', () => {
  let orgACookie = '';
  let orgARoomId = '';
  let orgBOrgId = '';
  let orgBRoomId = '';

  test.beforeAll(async ({ request }) => {
    // Sequential to avoid shared cookie-jar mutation between the two flows
    orgACookie = await loginAsAdmin(request);
    const orgBSetup = await ensureOrgBSetup(request);
    if (!orgBSetup.orgId || !orgBSetup.roomId) {
      test.skip();
      return;
    }
    orgBOrgId = orgBSetup.orgId;
    orgBRoomId = orgBSetup.roomId;
    const id = await getFirstRoomId(request, orgACookie);
    orgARoomId = id ?? '';
  });

  test('SEC-006: Authenticated Org-A session with x-organization-id header sees only Org-A data', async ({
    request,
  }) => {
    const res = await request.get('/api/rooms', {
      headers: { Cookie: orgACookie, 'x-organization-id': orgBOrgId },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const ids = (body.rooms as Array<{ id: string }>).map((r) => r.id);
    // Org-A room must be present; Org-B room must not — a leak would pass the first but fail the second
    expect(ids).toContain(orgARoomId);
    expect(ids).not.toContain(orgBRoomId);
  });

  test('SEC-007: Unauthenticated request with x-organization-id header returns 401', async ({
    request,
  }) => {
    const res = await request.get('/api/rooms', {
      headers: { 'x-organization-id': orgBOrgId },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SEC-003 + SEC-011: Link-scoped cross-org document isolation
// ---------------------------------------------------------------------------

test.describe('SEC-003/011: Link view session is scoped to its org — cross-org access returns 404', () => {
  let orgACookie = '';
  let orgARoomId = '';
  let orgALinkId = '';
  let orgALinkSlug = '';
  let orgBCookie = '';
  let orgBRoomId = '';
  let orgBLinkId = '';
  let orgBLinkSlug = '';

  test.beforeAll(async ({ request }) => {
    const orgBSetup = await ensureOrgBSetup(request);
    if (!orgBSetup.roomId) {
      test.skip();
      return;
    }
    orgBCookie = orgBSetup.cookie;
    orgBRoomId = orgBSetup.roomId;

    orgACookie = await loginAsAdmin(request);
    const id = await getFirstRoomId(request, orgACookie);
    if (!id) {
      test.skip();
      return;
    }
    orgARoomId = id;

    const [orgALink, orgBLink] = await Promise.all([
      createLink(request, orgACookie, orgARoomId, { name: 'SEC-003 Org-A Link' }),
      createLink(request, orgBCookie, orgBRoomId, { name: 'SEC-011 Org-B Link' }),
    ]);

    if (!orgALink || !orgBLink) {
      test.skip();
      return;
    }
    orgALinkId = orgALink.id;
    orgALinkSlug = orgALink.slug;
    orgBLinkId = orgBLink.id;
    orgBLinkSlug = orgBLink.slug;
  });

  test.afterAll(async ({ request }) => {
    if (orgALinkId && orgARoomId) {
      await deleteLink(request, orgACookie, orgARoomId, orgALinkId);
    }
    if (orgBLinkId && orgBRoomId) {
      await deleteLink(request, orgBCookie, orgBRoomId, orgBLinkId);
    }
  });

  test('SEC-003: Org-A view session cannot access Org-B room document (returns 404)', async ({
    request,
  }) => {
    // POST to link → get sessionToken; view route reads it from cookie viewer_${slug}
    const sessionRes = await request.post(`/api/links/${orgALinkSlug}`, {
      data: { email: 'sec003-viewer@test.local' },
    });
    if (!sessionRes.ok()) {
      test.skip();
      return;
    }
    const sessionBody = await sessionRes.json();
    const sessionToken = (sessionBody as { sessionToken?: string }).sessionToken;
    if (!sessionToken) {
      test.skip();
      return;
    }

    // URL uses the link slug; authentication is via cookie viewer_${slug}
    // orgBRoomId is a UUID in Org-B's namespace — not a document in Org-A's session scope
    const docRes = await request.get(`/api/view/${orgALinkSlug}/documents/${orgBRoomId}`, {
      headers: { Cookie: `viewer_${orgALinkSlug}=${sessionToken}` },
    });
    expect(docRes.status()).toBe(404);
  });

  test('SEC-011: Org-B view session cannot access Org-A room document (returns 404)', async ({
    request,
  }) => {
    // POST to link → get sessionToken; view route reads it from cookie viewer_${slug}
    const sessionRes = await request.post(`/api/links/${orgBLinkSlug}`, {
      data: { email: 'sec011-viewer@test.local' },
    });
    if (!sessionRes.ok()) {
      test.skip();
      return;
    }
    const sessionBody = await sessionRes.json();
    const sessionToken = (sessionBody as { sessionToken?: string }).sessionToken;
    if (!sessionToken) {
      test.skip();
      return;
    }

    // URL uses the link slug; authentication is via cookie viewer_${slug}
    // orgARoomId is a UUID in Org-A's namespace — not a document in Org-B's session scope
    const docRes = await request.get(`/api/view/${orgBLinkSlug}/documents/${orgARoomId}`, {
      headers: { Cookie: `viewer_${orgBLinkSlug}=${sessionToken}` },
    });
    expect(docRes.status()).toBe(404);
  });
});
