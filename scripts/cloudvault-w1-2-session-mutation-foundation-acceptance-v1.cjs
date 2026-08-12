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
const expectedMigration = '20260812210000_w1_2_session_mutation_foundation';
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
    sourceMd5: 'c5eaf4c683685818b4128f178acd74a8',
    contract: 'vaultspace-contract:w1-2-session-create-v1',
  },
  {
    name: 'bootstrap_session_refresh_v1',
    signature: 'public.bootstrap_session_refresh_v1(text)',
    identityArguments: 'input_token text',
    language: 'sql',
    sourceMd5: 'f747a5fedcee62492164961a77355a59',
    contract: 'vaultspace-contract:w1-2-session-refresh-v1',
  },
  {
    name: 'bootstrap_session_invalidate_v1',
    signature: 'public.bootstrap_session_invalidate_v1(text)',
    identityArguments: 'input_token text',
    language: 'sql',
    sourceMd5: 'c4b67ed0192a62783a9137a66392cb27',
    contract: 'vaultspace-contract:w1-2-session-invalidate-v1',
  },
  {
    name: 'bootstrap_session_revoke_user_org_v1',
    signature: 'public.bootstrap_session_revoke_user_org_v1(text, text)',
    identityArguments: 'input_user_id text, input_organization_id text',
    language: 'sql',
    sourceMd5: 'f14b7c036c3c23bc48c87088813db04a',
    contract: 'vaultspace-contract:w1-2-session-revoke-user-org-v1',
  },
  {
    name: 'bootstrap_session_revoke_user_global_v1',
    signature: 'public.bootstrap_session_revoke_user_global_v1(text, text)',
    identityArguments: 'input_user_id text, input_preserved_session_id text',
    language: 'sql',
    sourceMd5: '0cf271c362588da118143a391936f6c6',
    contract: 'vaultspace-contract:w1-2-session-revoke-user-global-v1',
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
const validEmail = 'w12-unit7-foundation-' + suffix + '@example.test';
const fixture = { userIds: [] };
const cloudVaultResults = [];

function pass(name) {
  console.log('PASS  ' + name);
}

async function check(name, operation) {
  await operation();
  pass(name);
}

async function cloudVaultCheck(name, operation) {
  await operation();
  cloudVaultResults.push(name);
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
    Accept: 'application/json',
    'User-Agent': 'VaultSpace-W1-2-Session-Mutation-Foundation-Acceptance',
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
  assert.equal(migrations.length, 1, 'foundation migration record must be unique');
  assert.ok(migrations[0].finished_at, 'foundation migration must be finished');
  assert.equal(migrations[0].rolled_back_at, null, 'foundation migration must not be rolled back');

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
       ) AS runtime_reaches_owner,
       pg_catalog.has_schema_privilege(
         'vaultspace_bootstrap_owner',
         'public',
         'CREATE'
       ) AS owner_schema_create`
  );
  assert.deepEqual(membership, {
    owner_membership_count: 0,
    runtime_reaches_owner: false,
    owner_schema_create: false,
  });

  const tablePrivileges = await db.$queryRawUnsafe(
    `SELECT table_name, privilege_type
       FROM information_schema.table_privileges
      WHERE table_schema = 'public'
        AND grantee = 'vaultspace_bootstrap_owner'
      ORDER BY table_name, privilege_type`
  );
  assert.deepEqual(tablePrivileges, [
    { table_name: 'organizations', privilege_type: 'SELECT' },
    { table_name: 'sessions', privilege_type: 'SELECT' },
    { table_name: 'user_organizations', privilege_type: 'SELECT' },
    { table_name: 'users', privilege_type: 'SELECT' },
  ]);

  const writeColumnPrivileges = await db.$queryRawUnsafe(
    `SELECT table_name, column_name, privilege_type
       FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND grantee = 'vaultspace_bootstrap_owner'
        AND privilege_type IN ('INSERT', 'UPDATE')
      ORDER BY table_name, column_name, privilege_type`
  );
  assert.deepEqual(writeColumnPrivileges, [
    { table_name: 'sessions', column_name: 'createdAt', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'expiresAt', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'expiresAt', privilege_type: 'UPDATE' },
    { table_name: 'sessions', column_name: 'id', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'ipAddress', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'isActive', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'isActive', privilege_type: 'UPDATE' },
    { table_name: 'sessions', column_name: 'lastActiveAt', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'lastActiveAt', privilege_type: 'UPDATE' },
    { table_name: 'sessions', column_name: 'organizationId', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'token', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'updatedAt', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'updatedAt', privilege_type: 'UPDATE' },
    { table_name: 'sessions', column_name: 'userAgent', privilege_type: 'INSERT' },
    { table_name: 'sessions', column_name: 'userId', privilege_type: 'INSERT' },
  ]);

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
      createHash('md5').update(fn.prosrc).digest('hex'),
      expected.sourceMd5,
      expected.name + ': source checksum'
    );
  }

  const ownerOnlyAcl = [{ grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' }];
  for (const fn of mutationFunctions) {
    assert.deepEqual(await functionAcl(fn.signature), ownerOnlyAcl, fn.name + ': owner-only ACL');
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
    pass('synthetic user, membership, and sessions soft-disabled');
  } catch {
    console.error('CLEANUP_FAILURE categorical');
    process.exitCode = 1;
  }
}

async function run() {
  let failed = false;

  try {
    await check('quick health matches the exact Unit 7 release', async () => {
      const health = await request('/api/health');
      expectStatus(health, 200, 'quick health');
      assert.equal(health.data?.status, 'healthy');
      assert.equal(health.data?.release, expectedRelease);
      assert.equal(health.data?.mode, 'azure');
      assert.deepEqual(health.data?.degraded, []);
      assert.match(health.data?.revision || '', /^ca-vaultspace-web--[0-9]+$/);
      assert.match(health.response.headers.get('cache-control') || '', /no-store/);
    });

    await check('migration, owner, privilege, checksum, and exact ACL posture', verifyCatalog);

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
        lastName: 'Unit 7 Foundation',
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
    await cloudVaultCheck('CloudVault login returns 200 with exact identity', async () => {
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
    });

    await cloudVaultCheck('CloudVault authenticated session returns 200', async () => {
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

    await cloudVaultCheck('CloudVault logout returns 200', async () => {
      const logout = await request('/api/auth/logout', {
        method: 'POST',
        cookie: sessionCookie,
        body: {},
      });
      expectStatus(logout, 200, 'logout');
    });

    await cloudVaultCheck('CloudVault post-logout session returns neutral 401', async () => {
      const denied = await request('/api/auth/me', { cookie: sessionCookie });
      expectStatus(denied, 401, 'post-logout session');
      assert.equal(denied.data?.error, 'Authentication required');
    });

    console.log(
      'SUMMARY PASS ' +
        cloudVaultResults.length +
        '/' +
        cloudVaultResults.length +
        ' CloudVault checks'
    );
    console.log('SYNTHETIC_USER_LABEL w12-unit7-foundation-' + suffix);
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
