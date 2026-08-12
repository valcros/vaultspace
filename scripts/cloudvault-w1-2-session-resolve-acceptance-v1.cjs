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
const expectedMigration = '20260812163000_w1_2_session_route_conversion';
const expectedSourceSha256 = '7b83946afec28fcb354c53792a714f7c7aef9ca8d2e3953e4aaee3f199a55916';
const expectedContract = 'vaultspace-contract:w1-2-session-resolve-v1';
const loginFunction = 'public.bootstrap_login_candidate_v1(text)';
const sessionFunction = 'public.bootstrap_session_resolve_v1(text)';
const organizationFunction = 'public.bootstrap_organization_resolve_v1(text, text)';
const sessionCookieName = 'vaultspace-session';

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
const validEmail = 'w12-unit5-session-' + suffix + '@example.test';
const fixture = {
  userIds: [],
};
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
    'User-Agent': 'VaultSpace-W1-2-Session-Resolve-Acceptance',
  };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(validatedBaseUrl + path, {
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
  assert.equal(membership.owner_membership_count, 0);
  assert.equal(membership.runtime_reaches_owner, false);

  const functions = await db.$queryRawUnsafe(
    `SELECT function.oid::text AS oid,
            pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
            pg_catalog.pg_get_function_result(function.oid) AS result_type,
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
        AND function.proname = 'bootstrap_session_resolve_v1'`
  );
  assert.equal(functions.length, 1, 'session function count');
  const fn = functions[0];
  assert.equal(fn.identity_arguments, 'input_token text');
  assert.equal(fn.owner_name, 'vaultspace_bootstrap_owner');
  assert.equal(fn.language_name, 'sql');
  assert.equal(fn.prosecdef, true);
  assert.equal(fn.provolatile, 's');
  assert.equal(fn.proparallel, 'r');
  assert.deepEqual(fn.proconfig, ['search_path=pg_catalog']);
  assert.equal(fn.contract, expectedContract);
  assert.equal(createHash('sha256').update(fn.prosrc).digest('hex'), expectedSourceSha256);
  assert.match(fn.result_type, /session_id text/);
  assert.match(fn.result_type, /organization_role text/);

  const ownerOnlyAcl = [{ grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' }];
  const ownerAndRuntimeAcl = [
    { grantee_name: 'vaultspace_app', privilege_type: 'EXECUTE' },
    { grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' },
  ];
  assert.deepEqual(await functionAcl(loginFunction), ownerAndRuntimeAcl);
  assert.deepEqual(await functionAcl(sessionFunction), ownerAndRuntimeAcl);
  assert.deepEqual(await functionAcl(organizationFunction), ownerOnlyAcl);

  const [privileges] = await db.$queryRawUnsafe(
    `SELECT
       pg_catalog.has_function_privilege('vaultspace_app', $1, 'EXECUTE') AS login_execute,
       pg_catalog.has_function_privilege('vaultspace_app', $2, 'EXECUTE') AS session_execute,
       pg_catalog.has_function_privilege('vaultspace_app', $3, 'EXECUTE') AS organization_execute`,
    loginFunction,
    sessionFunction,
    organizationFunction
  );
  assert.deepEqual(privileges, {
    login_execute: true,
    session_execute: true,
    organization_execute: false,
  });
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
    console.log('PASS  synthetic users, memberships, and sessions soft-disabled');
  } catch {
    console.error('CLEANUP_FAILURE categorical');
    process.exitCode = 1;
  }
}

async function run() {
  let failed = false;

  try {
    await check('quick health matches the exact Unit 5 release', async () => {
      const health = await request('/api/health');
      expectStatus(health, 200, 'quick health');
      assert.equal(health.data?.status, 'healthy');
      assert.equal(health.data?.release, expectedRelease);
      assert.deepEqual(health.data?.degraded, []);
      assert.match(health.data?.revision || '', /^ca-vaultspace-web--[0-9]+$/);
      assert.match(health.response.headers.get('cache-control') || '', /no-store/);
    });

    await check('conversion migration and exact catalog posture', verifyCatalog);

    const organizations = await db.organization.findMany({
      where: { slug: organizationSlug },
      select: { id: true, isActive: true, name: true, slug: true },
    });
    assert.deepEqual(organizations, [
      {
        id: organizations[0]?.id,
        isActive: true,
        name: expectedOrganizationName,
        slug: organizationSlug,
      },
    ]);
    const cloudVault = organizations[0];

    const passwordHash = await bcrypt.hash(accountPassword, 10);
    const validUser = await db.user.create({
      data: {
        email: validEmail,
        passwordHash,
        firstName: 'W1-2',
        lastName: 'Session Resolve',
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

    let firstCookie;
    await check('login returns 200 with exact CloudVault identity', async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: validEmail, password: accountPassword },
      });
      expectStatus(login, 200, 'valid login');
      assert.equal(login.data?.organization?.name, expectedOrganizationName);
      assert.equal(login.data?.organization?.slug, organizationSlug);
      assert.equal(login.data?.user?.email, validEmail);
      firstCookie = cookieFrom(login.response, sessionCookieName);
      assert.ok(firstCookie, 'valid login must return a session cookie');
    });

    await check('authenticated session resolves exact synthetic identity', async () => {
      const me = await request('/api/auth/me', { cookie: firstCookie });
      expectStatus(me, 200, 'auth me');
      assert.equal(me.data?.user?.email, validEmail);
      const liveSession = await db.session.findUnique({
        where: { token: tokenFromCookie(firstCookie) },
        select: { organizationId: true, userId: true, isActive: true },
      });
      assert.deepEqual(liveSession, {
        organizationId: cloudVault.id,
        userId: validUser.id,
        isActive: true,
      });
    });

    await check('server-component protected page returns authenticated shell', async () => {
      const dashboard = await request('/dashboard', {
        cookie: firstCookie,
        accept: 'text/html',
      });
      expectStatus(dashboard, 200, 'protected dashboard');
      assert.equal(dashboard.response.headers.get('location'), null);
      assert.match(dashboard.response.headers.get('content-type') || '', /^text\/html/);
    });

    await check('malformed and unknown sessions are denied', async () => {
      await expectSessionDenied(sessionCookieName + '=' + '!'.repeat(43), 'malformed session');
      const unknownToken = randomBytes(32).toString('base64url');
      assert.equal(unknownToken.length, 43);
      await expectSessionDenied(sessionCookieName + '=' + unknownToken, 'unknown session');
    });

    await check('idle-expired and absolute-expired sessions are denied', async () => {
      const now = Date.now();
      const idleExpiredToken = randomBytes(32).toString('base64url');
      const absoluteExpiredToken = randomBytes(32).toString('base64url');
      await db.session.createMany({
        data: [
          {
            userId: validUser.id,
            organizationId: cloudVault.id,
            token: idleExpiredToken,
            createdAt: new Date(now - 60 * 60 * 1000),
            expiresAt: new Date(now - 60 * 1000),
            lastActiveAt: new Date(now - 60 * 60 * 1000),
          },
          {
            userId: validUser.id,
            organizationId: cloudVault.id,
            token: absoluteExpiredToken,
            createdAt: new Date(now - 8 * 24 * 60 * 60 * 1000),
            expiresAt: new Date(now + 60 * 60 * 1000),
            lastActiveAt: new Date(now),
          },
        ],
      });
      await expectSessionDenied(sessionCookieName + '=' + idleExpiredToken, 'idle-expired session');
      await expectSessionDenied(
        sessionCookieName + '=' + absoluteExpiredToken,
        'absolute-expired session'
      );
    });

    await check('live revocation defeats the previously cached session', async () => {
      expectStatus(await request('/api/auth/me', { cookie: firstCookie }), 200, 'cache warm');
      await db.session.update({
        where: { token: tokenFromCookie(firstCookie) },
        data: { isActive: false },
      });
      await expectSessionDenied(firstCookie, 'stale cached session after live revocation');
    });

    let logoutCookie;
    await check('replacement login and session remain healthy', async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: validEmail, password: accountPassword },
      });
      expectStatus(login, 200, 'replacement login');
      logoutCookie = cookieFrom(login.response, sessionCookieName);
      assert.ok(logoutCookie, 'replacement login must return a session cookie');
      const me = await request('/api/auth/me', { cookie: logoutCookie });
      expectStatus(me, 200, 'replacement auth me');
      assert.equal(me.data?.user?.email, validEmail);
    });

    await check('logout succeeds and the old session returns 401', async () => {
      expectStatus(
        await request('/api/auth/logout', {
          method: 'POST',
          cookie: logoutCookie,
          body: {},
        }),
        200,
        'logout'
      );
      await expectSessionDenied(logoutCookie, 'post-logout session');
    });

    console.log('SUMMARY PASS ' + results.length + '/' + results.length + ' CloudVault checks');
    console.log('SYNTHETIC_FIXTURE ' + suffix);
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
