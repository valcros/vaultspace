#!/usr/bin/env node

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS operator runner. */

const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const baseUrl = process.env.QA_BASE_URL;
const organizationSlug = process.env.CLOUDVAULT_ORG_SLUG;
const databaseUrl = process.env.DATABASE_URL_ADMIN;
const expectedRelease = process.env.EXPECTED_RELEASE_SHA;
const expectedOrganizationName = 'CloudVault';
const requiredOrganizationSlug = 'cloudvault-w1-2-verify';
const expectedMigration = '20260812230000_w1_2_session_mutation_route_conversion';
const sessionCookieName = 'vaultspace-session';

const approvedRuntimeFunctions = [
  {
    function_name: 'bootstrap_login_candidate_v1',
    identity_arguments: 'input_email text',
  },
  {
    function_name: 'bootstrap_organization_resolve_v1',
    identity_arguments: 'input_lookup_kind text, input_lookup_value text',
  },
  {
    function_name: 'bootstrap_session_create_v1',
    identity_arguments:
      'input_user_id text, input_organization_id text, input_token text, input_expires_at timestamp with time zone, input_ip_address text, input_user_agent text',
  },
  {
    function_name: 'bootstrap_session_invalidate_v1',
    identity_arguments: 'input_token text',
  },
  {
    function_name: 'bootstrap_session_refresh_v1',
    identity_arguments: 'input_token text',
  },
  {
    function_name: 'bootstrap_session_resolve_v1',
    identity_arguments: 'input_token text',
  },
];

const mutationFunctions = [
  {
    name: 'bootstrap_session_create_v1',
    signature:
      'public.bootstrap_session_create_v1(text, text, text, timestamp with time zone, text, text)',
    identityArguments:
      'input_user_id text, input_organization_id text, input_token text, input_expires_at timestamp with time zone, input_ip_address text, input_user_agent text',
    language: 'plpgsql',
    sourceSha256: '184e265aa5787f474582b3d72514e7e9f6f287fcf0bdc0a550680eb65650840c',
    contract: 'vaultspace-contract:w1-2-session-create-v1',
    runtime: true,
  },
  {
    name: 'bootstrap_session_refresh_v1',
    signature: 'public.bootstrap_session_refresh_v1(text)',
    identityArguments: 'input_token text',
    language: 'sql',
    sourceSha256: '3e266b4bcba9471926160ed1388524d43ddf8c1936adbedeec3b408b34f0e681',
    contract: 'vaultspace-contract:w1-2-session-refresh-v1',
    runtime: true,
  },
  {
    name: 'bootstrap_session_invalidate_v1',
    signature: 'public.bootstrap_session_invalidate_v1(text)',
    identityArguments: 'input_token text',
    language: 'sql',
    sourceSha256: '2919babc1fdb1f9ad0fe9678e547e365c3df7df49bba988892589170bdc3e903',
    contract: 'vaultspace-contract:w1-2-session-invalidate-v1',
    runtime: true,
  },
  {
    name: 'bootstrap_session_revoke_user_org_v1',
    signature: 'public.bootstrap_session_revoke_user_org_v1(text, text)',
    identityArguments: 'input_user_id text, input_organization_id text',
    language: 'sql',
    sourceSha256: '7f43a9adde04f440731baeb84eebd3f1740986a22640ad418aa05d2c27194b3d',
    contract: 'vaultspace-contract:w1-2-session-revoke-user-org-v1',
    runtime: false,
  },
  {
    name: 'bootstrap_session_revoke_user_global_v1',
    signature: 'public.bootstrap_session_revoke_user_global_v1(text, text)',
    identityArguments: 'input_user_id text, input_preserved_session_id text',
    language: 'sql',
    sourceSha256: '8ce811e3be405f75f946793c3c6d752a2694ee4b44d66bca878ecd5b5151d35d',
    contract: 'vaultspace-contract:w1-2-session-revoke-user-global-v1',
    runtime: false,
  },
];

if (!baseUrl || !organizationSlug || !databaseUrl || !expectedRelease) {
  console.error(
    'QA_BASE_URL, CLOUDVAULT_ORG_SLUG, DATABASE_URL_ADMIN, and EXPECTED_RELEASE_SHA are required. Secret values are never printed.'
  );
  process.exit(2);
}

let validatedBaseUrl;
try {
  const candidate = new URL(baseUrl);
  const allowedHosts = new Set(['vaultspace.org', 'www.vaultspace.org']);
  assert.equal(candidate.protocol, 'https:', 'QA base URL must use HTTPS');
  assert.ok(allowedHosts.has(candidate.hostname), 'QA base URL must use vaultspace.org');
  assert.equal(candidate.pathname, '/', 'QA base URL must not include a path');
  assert.equal(organizationSlug, requiredOrganizationSlug, 'CloudVault verification slug');
  assert.match(expectedRelease, /^[0-9a-f]{40}$/, 'expected release must be a full Git SHA');
  validatedBaseUrl = candidate.origin;
} catch (error) {
  const message = error instanceof assert.AssertionError ? error.message : 'invalid target';
  console.error('QA_TARGET_REJECTED ' + message);
  process.exit(2);
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: [],
});

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const accountPassword = randomBytes(24).toString('base64url');
const validEmail = 'w12-unit8-mutation-' + suffix + '@example.test';
const fixture = { userIds: [] };
const results = [];

function pass(name) {
  results.push(name);
  console.log('PASS  ' + name);
}

async function check(name, operation) {
  await operation();
  pass(name);
}

function cookieFrom(response, name) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  const prefix = name + '=';

  for (const value of values) {
    const start = value.indexOf(prefix);
    if (start === -1) continue;
    const remainder = value.slice(start + prefix.length);
    const end = remainder.indexOf(';');
    return prefix + (end === -1 ? remainder : remainder.slice(0, end));
  }

  return null;
}

function tokenFromCookie(cookie) {
  assert.ok(cookie, 'session cookie is required');
  const prefix = sessionCookieName + '=';
  assert.ok(cookie.startsWith(prefix), 'session cookie name');
  const token = cookie.slice(prefix.length);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, 'session token shape');
  return token;
}

async function request(path, options = {}) {
  const headers = {
    Accept: options.accept || 'application/json',
    'User-Agent': 'VaultSpace-W1-2-Session-Mutation-Route-Acceptance',
    ...(options.headers || {}),
  };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(options.absoluteUrl || validatedBaseUrl + path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  const text = await response.text();
  let data = null;
  if (text && response.headers.get('content-type')?.includes('application/json')) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { response, status: response.status, data };
}

function expectStatus(actual, expected, label) {
  assert.equal(
    actual.status,
    expected,
    label + ': expected HTTP ' + expected + ', got ' + actual.status
  );
}

async function expectSessionDenied(cookie, label) {
  const denied = await request('/api/auth/me', { cookie });
  expectStatus(denied, 401, label);
  assert.equal(denied.data?.error, 'Authentication required', label + ': neutral message');
}

async function functionAcl(signature) {
  return db.$queryRawUnsafe(
    `SELECT CASE
              WHEN exploded.grantee = 0 THEN 'PUBLIC'
              ELSE grantee.rolname
            END AS grantee_name,
            exploded.privilege_type
       FROM pg_catalog.pg_proc AS function
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
       ) AS exploded
       LEFT JOIN pg_catalog.pg_roles AS grantee
         ON grantee.oid = exploded.grantee
      WHERE function.oid = pg_catalog.to_regprocedure($1)
        AND exploded.privilege_type = 'EXECUTE'
      ORDER BY grantee_name`,
    signature
  );
}

async function verifyCatalog() {
  const migrations = await db.$queryRawUnsafe(
    `SELECT migration_name, finished_at, rolled_back_at
       FROM public._prisma_migrations
      WHERE migration_name = $1`,
    expectedMigration
  );
  assert.equal(migrations.length, 1, 'conversion migration record must be unique');
  assert.ok(migrations[0].finished_at, 'conversion migration must be finished');
  assert.equal(migrations[0].rolled_back_at, null, 'conversion migration must not be rolled back');

  const owners = await db.$queryRawUnsafe(
    `SELECT oid::text AS oid,
            rolcanlogin,
            rolinherit,
            rolsuper,
            rolbypassrls,
            rolcreatedb,
            rolcreaterole,
            rolreplication
       FROM pg_catalog.pg_roles
      WHERE rolname = 'vaultspace_bootstrap_owner'`
  );
  assert.deepEqual(owners, [
    {
      oid: owners[0]?.oid,
      rolcanlogin: false,
      rolinherit: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    },
  ]);

  const [membership] = await db.$queryRawUnsafe(
    `SELECT
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_auth_members
         WHERE roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_bootstrap_owner')
            OR member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_bootstrap_owner')) AS owner_membership_count,
       pg_catalog.pg_has_role(
         (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app'),
         (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_bootstrap_owner'),
         'MEMBER'
       ) AS runtime_reaches_owner`
  );
  assert.deepEqual(membership, {
    owner_membership_count: 0,
    runtime_reaches_owner: false,
  });

  const [writePosture] = await db.$queryRawUnsafe(
    `SELECT
       pg_catalog.has_table_privilege('vaultspace_bootstrap_owner', 'public.sessions', 'INSERT') AS table_insert,
       pg_catalog.has_table_privilege('vaultspace_bootstrap_owner', 'public.sessions', 'UPDATE') AS table_update,
       pg_catalog.has_table_privilege('vaultspace_bootstrap_owner', 'public.sessions', 'DELETE') AS can_delete`
  );
  assert.deepEqual(writePosture, {
    table_insert: false,
    table_update: false,
    can_delete: false,
  });

  const functions = await db.$queryRawUnsafe(
    `SELECT function.proname AS function_name,
            pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
            owner.rolname AS owner_name,
            language.lanname AS language_name,
            function.prosecdef,
            function.provolatile,
            function.proparallel,
            function.proconfig,
            function.prosrc,
            pg_catalog.obj_description(function.oid, 'pg_proc') AS contract
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = function.pronamespace
       INNER JOIN pg_catalog.pg_roles AS owner
         ON owner.oid = function.proowner
       INNER JOIN pg_catalog.pg_language AS language
         ON language.oid = function.prolang
      WHERE namespace.nspname = 'public'
        AND function.proname = ANY($1::text[])
      ORDER BY function.proname`,
    mutationFunctions.map((fn) => fn.name)
  );
  assert.equal(functions.length, mutationFunctions.length, 'mutation function count');

  const ownerOnlyAcl = [{ grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' }];
  const runtimeAcl = [
    { grantee_name: 'vaultspace_app', privilege_type: 'EXECUTE' },
    { grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' },
  ];

  for (const expected of mutationFunctions) {
    const fn = functions.find((candidate) => candidate.function_name === expected.name);
    assert.ok(fn, expected.name + ': function required');
    assert.equal(fn.identity_arguments, expected.identityArguments, expected.name + ': arguments');
    assert.equal(fn.owner_name, 'vaultspace_bootstrap_owner', expected.name + ': owner');
    assert.equal(fn.language_name, expected.language, expected.name + ': language');
    assert.equal(fn.prosecdef, true, expected.name + ': SECURITY DEFINER');
    assert.equal(fn.provolatile, 'v', expected.name + ': volatility');
    assert.equal(fn.proparallel, 'u', expected.name + ': parallel mode');
    assert.deepEqual(fn.proconfig, ['search_path=pg_catalog'], expected.name + ': search path');
    assert.equal(fn.contract, expected.contract, expected.name + ': contract marker');
    assert.equal(
      createHash('sha256').update(fn.prosrc).digest('hex'),
      expected.sourceSha256,
      expected.name + ': source checksum'
    );
    assert.deepEqual(
      await functionAcl(expected.signature),
      expected.runtime ? runtimeAcl : ownerOnlyAcl,
      expected.name + ': exact ACL'
    );
  }

  const appBootstrapFunctions = await db.$queryRawUnsafe(
    `SELECT function.proname AS function_name,
            pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = function.pronamespace
      WHERE namespace.nspname = 'public'
        AND function.proname LIKE 'bootstrap\\_%' ESCAPE '\\'
        AND pg_catalog.has_function_privilege('vaultspace_app', function.oid, 'EXECUTE')
      ORDER BY function.proname, identity_arguments`
  );
  assert.deepEqual(appBootstrapFunctions, approvedRuntimeFunctions);

  const publicBootstrapFunctions = await db.$queryRawUnsafe(
    `SELECT function.proname AS function_name
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = function.pronamespace
      WHERE namespace.nspname = 'public'
        AND function.proname LIKE 'bootstrap\\_%' ESCAPE '\\'
        AND EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
            ) AS exploded
           WHERE exploded.grantee = 0
             AND exploded.privilege_type = 'EXECUTE'
        )`
  );
  assert.deepEqual(publicBootstrapFunctions, []);
}

async function pollForRefresh(token, before) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await db.session.findUnique({
      where: { token },
      select: { expiresAt: true, lastActiveAt: true },
    });
    if (
      current &&
      current.lastActiveAt > before.lastActiveAt &&
      current.expiresAt > before.expiresAt
    ) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('sliding refresh did not advance the synthetic session within six seconds');
}

async function cleanup() {
  try {
    if (fixture.userIds.length) {
      await db.session.updateMany({
        where: { userId: { in: fixture.userIds } },
        data: { isActive: false },
      });
      await db.userOrganization.updateMany({
        where: { userId: { in: fixture.userIds } },
        data: { isActive: false },
      });
      await db.user.updateMany({
        where: { id: { in: fixture.userIds } },
        data: { isActive: false },
      });
    }

    const [remaining] = await db.$queryRawUnsafe(
      `SELECT
         (SELECT pg_catalog.count(*)::integer FROM public.users WHERE id = ANY($1::text[]) AND "isActive") AS active_users,
         (SELECT pg_catalog.count(*)::integer FROM public.user_organizations WHERE "userId" = ANY($1::text[]) AND "isActive") AS active_memberships,
         (SELECT pg_catalog.count(*)::integer FROM public.sessions WHERE "userId" = ANY($1::text[]) AND "isActive") AS active_sessions`,
      fixture.userIds
    );
    assert.deepEqual(remaining, {
      active_users: 0,
      active_memberships: 0,
      active_sessions: 0,
    });
    console.log(
      'PASS  synthetic user, membership, and sessions soft-disabled; CloudVault retained'
    );
  } catch {
    console.error('CLEANUP_FAILURE categorical');
    process.exitCode = 1;
  }
}

async function run() {
  let failed = false;

  try {
    await check('quick health matches the exact Unit 8 release', async () => {
      const health = await request('/api/health');
      expectStatus(health, 200, 'quick health');
      assert.equal(health.data?.status, 'healthy');
      assert.equal(health.data?.release, expectedRelease);
      assert.equal(health.data?.mode, 'azure');
      assert.deepEqual(health.data?.degraded, []);
      assert.match(health.data?.revision || '', /^ca-vaultspace-web--[0-9]+$/);
      assert.match(health.response.headers.get('cache-control') || '', /no-store/);
    });

    await check(
      'conversion migration, owner posture, checksums, and exact six-function ACL',
      verifyCatalog
    );

    const organizations = await db.organization.findMany({
      where: { slug: organizationSlug },
      select: {
        id: true,
        isActive: true,
        name: true,
        slug: true,
        logoUrl: true,
        primaryColor: true,
        faviconUrl: true,
      },
    });
    assert.equal(organizations.length, 1, 'CloudVault slug must resolve exactly once');
    const cloudVault = organizations[0];
    assert.equal(cloudVault.name, expectedOrganizationName);
    assert.equal(cloudVault.slug, organizationSlug);
    assert.equal(cloudVault.isActive, true);

    const passwordHash = await bcrypt.hash(accountPassword, 10);
    const validUser = await db.user.create({
      data: {
        email: validEmail,
        passwordHash,
        firstName: 'W1-2',
        lastName: 'Session Mutation',
        emailVerifiedAt: new Date(),
      },
    });
    fixture.userIds.push(validUser.id);
    await db.userOrganization.create({
      data: {
        organizationId: cloudVault.id,
        userId: validUser.id,
        role: 'VIEWER',
      },
    });

    let sessionCookie;
    let sessionToken;
    await check('login creates one active CloudVault session with exact identity', async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: validEmail, password: accountPassword },
      });
      expectStatus(login, 200, 'valid login');
      assert.equal(login.data?.organization?.name, expectedOrganizationName);
      assert.equal(login.data?.organization?.slug, organizationSlug);
      assert.equal(login.data?.user?.email, validEmail);
      sessionCookie = cookieFrom(login.response, sessionCookieName);
      sessionToken = tokenFromCookie(sessionCookie);
      const sessions = await db.session.findMany({
        where: { userId: validUser.id, isActive: true },
        select: { organizationId: true, token: true, userAgent: true },
      });
      assert.deepEqual(sessions, [
        {
          organizationId: cloudVault.id,
          token: sessionToken,
          userAgent: 'VaultSpace-W1-2-Session-Mutation-Route-Acceptance',
        },
      ]);
    });

    await check('session resolve and protected shell remain green', async () => {
      const me = await request('/api/auth/me', { cookie: sessionCookie });
      expectStatus(me, 200, 'auth me');
      assert.equal(me.data?.user?.email, validEmail);
      const dashboard = await request('/dashboard', {
        cookie: sessionCookie,
        accept: 'text/html',
      });
      expectStatus(dashboard, 200, 'protected dashboard');
      assert.equal(dashboard.response.headers.get('location'), null);
    });

    await check(
      'organization resolve returns only the approved CloudVault branding projection',
      async () => {
        const branding = await request('/api/public/branding', {
          headers: { 'x-org-slug': organizationSlug },
        });
        expectStatus(branding, 200, 'public branding');
        assert.deepEqual(Object.keys(branding.data || {}).sort(), ['branding', 'detected']);
        assert.equal(branding.data?.detected, true);
        assert.deepEqual(branding.data?.branding, {
          name: expectedOrganizationName,
          slug: organizationSlug,
          logoUrl: cloudVault.logoUrl,
          primaryColor: cloudVault.primaryColor,
          faviconUrl: cloudVault.faviconUrl,
        });
      }
    );

    await check('sliding refresh advances the authoritative synthetic session', async () => {
      const forced = {
        lastActiveAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };
      await db.session.update({
        where: { token: sessionToken },
        data: forced,
      });
      const me = await request('/api/auth/me', { cookie: sessionCookie });
      expectStatus(me, 200, 'auth me triggering refresh');
      const refreshed = await pollForRefresh(sessionToken, forced);
      assert.ok(refreshed.expiresAt.getTime() > Date.now() + 23 * 60 * 60 * 1000);
    });

    await check('logout invalidates the exact token and defeats its cache entry', async () => {
      expectStatus(await request('/api/auth/me', { cookie: sessionCookie }), 200, 'cache warm');
      const logout = await request('/api/auth/logout', {
        method: 'POST',
        cookie: sessionCookie,
        body: {},
      });
      expectStatus(logout, 200, 'logout');
      const stored = await db.session.findUnique({
        where: { token: sessionToken },
        select: { isActive: true },
      });
      assert.deepEqual(stored, { isActive: false });
      await expectSessionDenied(sessionCookie, 'post-logout cached session');
    });

    await check('unknown token remains a neutral 401', async () => {
      const unknownToken = randomBytes(32).toString('base64url');
      await expectSessionDenied(sessionCookieName + '=' + unknownToken, 'unknown session');
    });

    console.log('SUMMARY PASS ' + results.length + '/' + results.length + ' CloudVault checks');
    console.log('SYNTHETIC_FIXTURE w12-unit8-mutation-' + suffix);
  } catch (error) {
    failed = true;
    const detail = error instanceof assert.AssertionError ? error.message : 'categorical';
    console.error('FAIL  ' + detail);
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  if (failed) process.exit(1);
}

void run();
