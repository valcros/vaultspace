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
const expectedMigration = '20260812190000_w1_2_organization_route_conversion';
const expectedSourceSha256 = '27cc50a7040e357fc49cb9a838432df9b0a5b9845aa49640acf2a71d4bc14df7';
const expectedContract = 'vaultspace-contract:w1-2-organization-resolve-v1';
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
  assert.match(organizationSlug, /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/);
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
const validEmail = 'w12-unit6-org-' + suffix + '@example.test';
const syntheticCustomDomain = 'cloudvault-unit6-' + suffix + '.example.test';
const unknownSlug = 'w12-unit6-unknown-' + suffix;
const unknownDomain = 'w12-unit6-unknown-' + suffix + '.example.test';
const fixture = {
  userIds: [],
  organizationId: null,
  organizationCaptured: false,
  originalOrganizationActive: null,
  originalCustomDomain: null,
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
    'User-Agent': 'VaultSpace-W1-2-Organization-Resolve-Acceptance',
    ...(options.headers || {}),
  };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const target = options.absoluteUrl || validatedBaseUrl + path;
  const response = await fetch(target, {
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
  return { response, status: response.status, data, text };
}

function expectStatus(actual, expected, label) {
  assert.equal(
    actual.status,
    expected,
    label + ': expected HTTP ' + expected + ', got ' + actual.status
  );
}

function expectNeutralBranding(actual, label) {
  expectStatus(actual, 200, label);
  assert.deepEqual(actual.data, { branding: null, detected: false }, label + ': neutral response');
}

function expectApprovedBranding(actual, expectedBranding, label) {
  expectStatus(actual, 200, label);
  assert.deepEqual(Object.keys(actual.data || {}).sort(), ['branding', 'detected']);
  assert.equal(actual.data?.detected, true, label + ': organization detected');
  assert.deepEqual(Object.keys(actual.data?.branding || {}).sort(), [
    'faviconUrl',
    'logoUrl',
    'name',
    'primaryColor',
    'slug',
  ]);
  assert.deepEqual(actual.data?.branding, expectedBranding, label + ': exact public projection');
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
    `SELECT pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
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
        AND function.proname = 'bootstrap_organization_resolve_v1'`
  );
  assert.equal(functions.length, 1, 'organization function count');
  const fn = functions[0];
  assert.equal(fn.identity_arguments, 'input_lookup_kind text, input_lookup_value text');
  assert.equal(fn.owner_name, 'vaultspace_bootstrap_owner');
  assert.equal(fn.language_name, 'sql');
  assert.equal(fn.prosecdef, true);
  assert.equal(fn.provolatile, 's');
  assert.equal(fn.proparallel, 'r');
  assert.deepEqual(fn.proconfig, ['search_path=pg_catalog']);
  assert.equal(fn.contract, expectedContract);
  assert.equal(createHash('sha256').update(fn.prosrc).digest('hex'), expectedSourceSha256);
  assert.match(fn.result_type, /organization_id text/);
  assert.match(fn.result_type, /custom_domain text/);
  assert.match(fn.result_type, /favicon_url text/);

  const ownerAndRuntimeAcl = [
    { grantee_name: 'vaultspace_app', privilege_type: 'EXECUTE' },
    { grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' },
  ];
  assert.deepEqual(await functionAcl(loginFunction), ownerAndRuntimeAcl);
  assert.deepEqual(await functionAcl(sessionFunction), ownerAndRuntimeAcl);
  assert.deepEqual(await functionAcl(organizationFunction), ownerAndRuntimeAcl);

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
  assert.deepEqual(appBootstrapFunctions, [
    { function_name: 'bootstrap_login_candidate_v1', identity_arguments: 'input_email text' },
    {
      function_name: 'bootstrap_organization_resolve_v1',
      identity_arguments: 'input_lookup_kind text, input_lookup_value text',
    },
    { function_name: 'bootstrap_session_resolve_v1', identity_arguments: 'input_token text' },
  ]);

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

    if (fixture.organizationCaptured && fixture.organizationId) {
      await db.organization.update({
        where: { id: fixture.organizationId },
        data: {
          isActive: fixture.originalOrganizationActive,
          customDomain: fixture.originalCustomDomain,
        },
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

    if (fixture.organizationCaptured && fixture.organizationId) {
      const restored = await db.organization.findUnique({
        where: { id: fixture.organizationId },
        select: { name: true, slug: true, isActive: true, customDomain: true },
      });
      assert.deepEqual(restored, {
        name: expectedOrganizationName,
        slug: organizationSlug,
        isActive: fixture.originalOrganizationActive,
        customDomain: fixture.originalCustomDomain,
      });
    }
    console.log(
      'PASS  synthetic user, membership, and sessions soft-disabled; CloudVault restored'
    );
  } catch {
    console.error('CLEANUP_FAILURE categorical');
    process.exitCode = 1;
  }
}

async function run() {
  let failed = false;

  try {
    await check('quick health matches the exact Unit 6 release', async () => {
      const health = await request('/api/health');
      expectStatus(health, 200, 'quick health');
      assert.equal(health.data?.status, 'healthy');
      assert.equal(health.data?.release, expectedRelease);
      assert.deepEqual(health.data?.degraded, []);
      assert.match(health.data?.revision || '', /^ca-vaultspace-web--[0-9]+$/);
      assert.match(health.response.headers.get('cache-control') || '', /no-store/);
    });

    await check('conversion migration and exact three-function catalog posture', verifyCatalog);

    const organizations = await db.organization.findMany({
      where: { slug: organizationSlug },
      select: {
        id: true,
        isActive: true,
        name: true,
        slug: true,
        customDomain: true,
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
    fixture.organizationId = cloudVault.id;
    fixture.organizationCaptured = true;
    fixture.originalOrganizationActive = cloudVault.isActive;
    fixture.originalCustomDomain = cloudVault.customDomain;

    const customDomain = cloudVault.customDomain || syntheticCustomDomain;
    if (!cloudVault.customDomain) {
      await db.organization.update({
        where: { id: cloudVault.id },
        data: { customDomain },
      });
    }

    const expectedBranding = {
      name: expectedOrganizationName,
      slug: organizationSlug,
      logoUrl: cloudVault.logoUrl,
      primaryColor: cloudVault.primaryColor,
      faviconUrl: cloudVault.faviconUrl,
    };

    const passwordHash = await bcrypt.hash(accountPassword, 10);
    const validUser = await db.user.create({
      data: {
        email: validEmail,
        passwordHash,
        firstName: 'W1-2',
        lastName: 'Organization Resolve',
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
    await check('login and session retain exact CloudVault identity', async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: validEmail, password: accountPassword },
      });
      expectStatus(login, 200, 'valid login');
      assert.equal(login.data?.organization?.name, expectedOrganizationName);
      assert.equal(login.data?.organization?.slug, organizationSlug);
      assert.equal(login.data?.user?.email, validEmail);
      sessionCookie = cookieFrom(login.response, sessionCookieName);
      assert.ok(sessionCookie, 'valid login must return a session cookie');

      const me = await request('/api/auth/me', { cookie: sessionCookie });
      expectStatus(me, 200, 'auth me');
      assert.equal(me.data?.user?.email, validEmail);
      const liveSession = await db.session.findUnique({
        where: { token: tokenFromCookie(sessionCookie) },
        select: { organizationId: true, userId: true, isActive: true },
      });
      assert.deepEqual(liveSession, {
        organizationId: cloudVault.id,
        userId: validUser.id,
        isActive: true,
      });
    });

    await check('header slug returns only approved public branding fields', async () => {
      const branding = await request('/api/public/branding', {
        headers: { 'x-org-slug': organizationSlug },
      });
      expectApprovedBranding(branding, expectedBranding, 'header slug branding');
    });

    await check('canonical CloudVault subdomain returns approved branding', async () => {
      const branding = await request('/api/public/branding', {
        absoluteUrl: 'https://' + organizationSlug + '.vaultspace.org/api/public/branding',
      });
      expectApprovedBranding(branding, expectedBranding, 'canonical subdomain branding');
    });

    await check('custom-domain header returns approved branding without DNS changes', async () => {
      const branding = await request('/api/public/branding', {
        headers: { 'x-custom-host': customDomain },
      });
      expectApprovedBranding(branding, expectedBranding, 'custom-domain branding');
    });

    await check('organization landing resolves to the canonical organization login', async () => {
      const landing = await request('/org/' + organizationSlug, { accept: 'text/html' });
      expectStatus(landing, 307, 'organization landing');
      assert.equal(landing.response.headers.get('location'), '/auth/login?org=' + organizationSlug);
    });

    await check('unknown slug and domain return the same neutral branding response', async () => {
      expectNeutralBranding(
        await request('/api/public/branding', {
          headers: { 'x-org-slug': unknownSlug },
        }),
        'unknown slug'
      );
      expectNeutralBranding(
        await request('/api/public/branding', {
          headers: { 'x-custom-host': unknownDomain },
        }),
        'unknown domain'
      );
    });

    await check(
      'inactive CloudVault returns neutral branding and is restored immediately',
      async () => {
        await db.organization.update({ where: { id: cloudVault.id }, data: { isActive: false } });
        try {
          expectNeutralBranding(
            await request('/api/public/branding', {
              headers: { 'x-org-slug': organizationSlug },
            }),
            'inactive slug'
          );
          expectNeutralBranding(
            await request('/api/public/branding', {
              headers: { 'x-custom-host': customDomain },
            }),
            'inactive custom domain'
          );
        } finally {
          await db.organization.update({ where: { id: cloudVault.id }, data: { isActive: true } });
        }
      }
    );

    await check('login and session recover after the bounded inactive check', async () => {
      const me = await request('/api/auth/me', { cookie: sessionCookie });
      expectStatus(me, 200, 'auth me after restore');
      assert.equal(me.data?.user?.email, validEmail);
      const restoredOrganization = await db.organization.findUnique({
        where: { id: cloudVault.id },
        select: { name: true, slug: true, isActive: true },
      });
      assert.deepEqual(restoredOrganization, {
        name: expectedOrganizationName,
        slug: organizationSlug,
        isActive: true,
      });
    });

    await check('logout succeeds and the old session returns 401', async () => {
      const logout = await request('/api/auth/logout', {
        method: 'POST',
        cookie: sessionCookie,
        body: {},
      });
      expectStatus(logout, 200, 'logout');
      const denied = await request('/api/auth/me', { cookie: sessionCookie });
      expectStatus(denied, 401, 'post-logout session');
      assert.equal(denied.data?.error, 'Authentication required');
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
