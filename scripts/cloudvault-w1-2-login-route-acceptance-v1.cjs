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
const expectedOrganizationName = 'CloudVault';
const expectedMigration = '20260812143000_w1_2_login_route_conversion';
const expectedSourceSha256 = '72b12f72ab12ca301cce0b168463dd294df01fa2c0ca1e07b8668643b267db38';
const expectedContract = 'vaultspace-contract:w1-2-login-candidate-v1';
const loginFunction = 'public.bootstrap_login_candidate_v1(text)';
const sessionFunction = 'public.bootstrap_session_resolve_v1(text)';
const organizationFunction = 'public.bootstrap_organization_resolve_v1(text, text)';

if (!baseUrl || !organizationSlug || !databaseUrl) {
  console.error(
    'QA_BASE_URL, CLOUDVAULT_ORG_SLUG, and DATABASE_URL_ADMIN are required. Secret values are never printed.'
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
const wrongPassword = randomBytes(24).toString('base64url');
const validEmail = 'w12-unit4-valid-' + suffix + '@example.test';
const inactiveUserEmail = 'w12-unit4-inactive-user-' + suffix + '@example.test';
const inactiveMembershipEmail = 'w12-unit4-inactive-membership-' + suffix + '@example.test';
const inactiveOrganizationEmail = 'w12-unit4-inactive-org-' + suffix + '@example.test';
const twoFactorEmail = 'w12-unit4-2fa-' + suffix + '@example.test';
const unknownEmail = 'w12-unit4-unknown-' + suffix + '@example.test';

const fixture = {
  userIds: [],
  inactiveOrganizationId: null,
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

async function api(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'VaultSpace-W1-2-Login-Route-Acceptance',
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
  if (text) {
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

async function expectNeutralDenial(email, password, label) {
  const denied = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  expectStatus(denied, 401, label);
  assert.equal(denied.data?.error, 'Invalid email or password', label + ': neutral message');
  assert.equal(cookieFrom(denied.response, 'vaultspace-session'), null, label + ': no cookie');
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
        AND function.proname = 'bootstrap_login_candidate_v1'`
  );
  assert.equal(functions.length, 1, 'login function count');
  const fn = functions[0];
  assert.equal(fn.identity_arguments, 'input_email text');
  assert.equal(fn.owner_name, 'vaultspace_bootstrap_owner');
  assert.equal(fn.language_name, 'sql');
  assert.equal(fn.prosecdef, true);
  assert.equal(fn.provolatile, 's');
  assert.equal(fn.proparallel, 'r');
  assert.deepEqual(fn.proconfig, ['search_path=pg_catalog']);
  assert.equal(fn.contract, expectedContract);
  assert.equal(createHash('sha256').update(fn.prosrc).digest('hex'), expectedSourceSha256);
  assert.match(fn.result_type, /TABLE\(/);

  const acl = await db.$queryRawUnsafe(
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
    loginFunction
  );
  assert.deepEqual(acl, [
    { grantee_name: 'vaultspace_app', privilege_type: 'EXECUTE' },
    { grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' },
  ]);

  const [privileges] = await db.$queryRawUnsafe(
    `SELECT
       pg_catalog.has_function_privilege('vaultspace_app', $1, 'EXECUTE') AS login_execute,
       pg_catalog.has_function_privilege('vaultspace_app', $2, 'EXECUTE') AS session_execute,
       pg_catalog.has_function_privilege('vaultspace_app', $3, 'EXECUTE') AS organization_execute`,
    loginFunction,
    sessionFunction,
    organizationFunction
  );
  assert.equal(privileges.login_execute, true);
  assert.equal(privileges.session_execute, false);
  assert.equal(privileges.organization_execute, false);
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
    if (fixture.inactiveOrganizationId) {
      await db.organization.update({
        where: { id: fixture.inactiveOrganizationId },
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
    const users = await Promise.all([
      db.user.create({
        data: {
          email: validEmail,
          passwordHash,
          firstName: 'W1-2',
          lastName: 'Valid Login',
          emailVerifiedAt: new Date(),
        },
      }),
      db.user.create({
        data: {
          email: inactiveUserEmail,
          passwordHash,
          firstName: 'W1-2',
          lastName: 'Inactive User',
          emailVerifiedAt: new Date(),
          isActive: false,
        },
      }),
      db.user.create({
        data: {
          email: inactiveMembershipEmail,
          passwordHash,
          firstName: 'W1-2',
          lastName: 'Inactive Membership',
          emailVerifiedAt: new Date(),
        },
      }),
      db.user.create({
        data: {
          email: twoFactorEmail,
          passwordHash,
          firstName: 'W1-2',
          lastName: 'Two Factor',
          emailVerifiedAt: new Date(),
          twoFactorEnabled: true,
        },
      }),
    ]);
    fixture.userIds.push(...users.map((user) => user.id));
    const [validUser, inactiveUser, inactiveMembershipUser, twoFactorUser] = users;

    const inactiveOrganization = await db.organization.create({
      data: {
        name: 'CloudVault synthetic inactive ' + suffix,
        slug: 'cloudvault-w12-inactive-' + suffix,
        isActive: false,
      },
    });
    fixture.inactiveOrganizationId = inactiveOrganization.id;
    const inactiveOrganizationUser = await db.user.create({
      data: {
        email: inactiveOrganizationEmail,
        passwordHash,
        firstName: 'W1-2',
        lastName: 'Inactive Organization',
        emailVerifiedAt: new Date(),
      },
    });
    fixture.userIds.push(inactiveOrganizationUser.id);

    await db.userOrganization.createMany({
      data: [
        { organizationId: cloudVault.id, userId: validUser.id, role: 'VIEWER' },
        { organizationId: cloudVault.id, userId: inactiveUser.id, role: 'VIEWER' },
        {
          organizationId: cloudVault.id,
          userId: inactiveMembershipUser.id,
          role: 'VIEWER',
          isActive: false,
        },
        { organizationId: cloudVault.id, userId: twoFactorUser.id, role: 'VIEWER' },
        {
          organizationId: inactiveOrganization.id,
          userId: inactiveOrganizationUser.id,
          role: 'VIEWER',
        },
      ],
    });

    await check('invalid password returns neutral 401', async () => {
      await expectNeutralDenial(validEmail, wrongPassword, 'invalid password');
    });
    await check('unknown user returns neutral 401', async () => {
      await expectNeutralDenial(unknownEmail, accountPassword, 'unknown user');
    });
    await check('inactive user returns neutral 401', async () => {
      await expectNeutralDenial(inactiveUserEmail, accountPassword, 'inactive user');
    });
    await check('inactive membership returns neutral 401', async () => {
      await expectNeutralDenial(inactiveMembershipEmail, accountPassword, 'inactive membership');
    });
    await check('inactive organization returns neutral 401', async () => {
      await expectNeutralDenial(
        inactiveOrganizationEmail,
        accountPassword,
        'inactive organization'
      );
    });

    let authenticatedCookie;
    await check('valid password login returns exact CloudVault identity', async () => {
      const login = await api('/api/auth/login', {
        method: 'POST',
        body: { email: validEmail, password: accountPassword },
      });
      expectStatus(login, 200, 'valid login');
      assert.equal(login.data?.organization?.name, expectedOrganizationName);
      assert.equal(login.data?.organization?.slug, organizationSlug);
      assert.equal(login.data?.user?.email, validEmail);
      authenticatedCookie = cookieFrom(login.response, 'vaultspace-session');
      assert.ok(authenticatedCookie, 'valid login must return a session cookie');
    });
    await check('authenticated session returns 200', async () => {
      expectStatus(await api('/api/auth/me', { cookie: authenticatedCookie }), 200, 'auth me');
    });
    await check('logout invalidates the prior session', async () => {
      expectStatus(
        await api('/api/auth/logout', {
          method: 'POST',
          cookie: authenticatedCookie,
          body: {},
        }),
        200,
        'logout'
      );
      expectStatus(
        await api('/api/auth/me', { cookie: authenticatedCookie }),
        401,
        'post-logout session'
      );
    });
    await check('two-factor branch returns no password-login session', async () => {
      const sessionsBefore = await db.session.count({ where: { userId: twoFactorUser.id } });
      const login = await api('/api/auth/login', {
        method: 'POST',
        body: { email: twoFactorEmail, password: accountPassword },
      });
      expectStatus(login, 200, 'two-factor login branch');
      assert.equal(login.data?.requiresTwoFactor, true);
      assert.equal(typeof login.data?.tempToken, 'string');
      assert.equal(cookieFrom(login.response, 'vaultspace-session'), null);
      const sessionsAfter = await db.session.count({ where: { userId: twoFactorUser.id } });
      assert.equal(sessionsAfter, sessionsBefore);
    });

    console.log(
      'PASS  live rate-limit lockout not forced; automated categorical coverage retained'
    );
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
