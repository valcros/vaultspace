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
const expectedMigration = '20260813050000_w1_2_bounded_bulk_session_revocation';
const sessionCookieName = 'vaultspace-session';

const approvedRuntimeFunctions = [
  ['bootstrap_login_candidate_v1', 'input_email text'],
  ['bootstrap_organization_resolve_v1', 'input_lookup_kind text, input_lookup_value text'],
  [
    'bootstrap_session_create_v1',
    'input_user_id text, input_organization_id text, input_token text, input_expires_at timestamp with time zone, input_ip_address text, input_user_agent text',
  ],
  ['bootstrap_session_invalidate_v1', 'input_token text'],
  ['bootstrap_session_refresh_v1', 'input_token text'],
  ['bootstrap_session_resolve_v1', 'input_token text'],
  [
    'bootstrap_session_revoke_admin_user_global_single_org_v1',
    'input_actor_token text, input_target_user_id text',
  ],
  [
    'bootstrap_session_revoke_admin_user_org_v1',
    'input_actor_token text, input_target_user_id text',
  ],
  ['bootstrap_session_revoke_self_others_v1', 'input_actor_token text'],
].map(([function_name, identity_arguments]) => ({ function_name, identity_arguments }));

const boundedFunctions = [
  {
    name: 'bootstrap_session_revoke_self_others_v1',
    signature: 'public.bootstrap_session_revoke_self_others_v1(text)',
    identityArguments: 'input_actor_token text',
    sourceSha256: '4e23e309a5a10ec0691eb2bea2181a8f0cf4ddef8c94a24c22ec7b566742a387',
    contract: 'vaultspace-contract:w1-2-session-revoke-self-others-v1',
  },
  {
    name: 'bootstrap_session_revoke_admin_user_org_v1',
    signature: 'public.bootstrap_session_revoke_admin_user_org_v1(text, text)',
    identityArguments: 'input_actor_token text, input_target_user_id text',
    sourceSha256: 'ea43d78e7c5c1f35a0182de1c6f1404e96063d4cedad2f4ed11e8289ec02b470',
    contract: 'vaultspace-contract:w1-2-session-revoke-admin-user-org-v1',
  },
  {
    name: 'bootstrap_session_revoke_admin_user_global_single_org_v1',
    signature: 'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)',
    identityArguments: 'input_actor_token text, input_target_user_id text',
    sourceSha256: 'e8a5a54cc631ed26da6f6cf36260d2ba3d8f3d567bf081d4078a0e2ff87a9b2d',
    contract: 'vaultspace-contract:w1-2-session-revoke-admin-user-global-single-org-v1',
  },
];

const genericFunctions = [
  'public.bootstrap_session_revoke_user_org_v1(text, text)',
  'public.bootstrap_session_revoke_user_global_v1(text, text)',
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

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const password = randomBytes(24).toString('base64url');
const newPassword = randomBytes(24).toString('base64url');
const fixture = { userIds: [], organizationIds: [] };
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

function cookieForToken(token) {
  return sessionCookieName + '=' + token;
}

async function request(path, options = {}) {
  const headers = {
    Accept: options.accept || 'application/json',
    'User-Agent': 'VaultSpace-W1-2-Bounded-Bulk-Revocation-Acceptance',
    ...(options.headers || {}),
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
  assert.equal(actual.status, expected, label + ': expected HTTP ' + expected);
}

async function expectSession(cookie, expectedStatus, label) {
  const response = await request('/api/auth/me', { cookie });
  expectStatus(response, expectedStatus, label);
  if (expectedStatus === 401) {
    assert.equal(response.data?.error, 'Authentication required', label + ': neutral denial');
  }
  return response;
}

async function login(email, accountPassword = password) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: accountPassword },
  });
  expectStatus(response, 200, 'synthetic login');
  const cookie = cookieFrom(response.response, sessionCookieName);
  return { cookie, token: tokenFromCookie(cookie), response };
}

async function createRawSession(userId, organizationId) {
  const rawToken = randomBytes(32).toString('base64url');
  const now = new Date();
  const session = await db.session.create({
    data: {
      id: randomUUID(),
      userId,
      organizationId,
      token: rawToken,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      isActive: true,
      userAgent: 'VaultSpace-W1-2-Bounded-Bulk-Revocation-Acceptance',
    },
  });
  return { ...session, rawToken, cookie: cookieForToken(rawToken) };
}

async function functionAcl(signature) {
  return db.$queryRawUnsafe(
    `SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE role.rolname END AS grantee_name,
            acl.privilege_type
       FROM pg_catalog.pg_proc AS function
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
       ) AS acl
       LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
      WHERE function.oid = pg_catalog.to_regprocedure($1)
        AND acl.privilege_type = 'EXECUTE'
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
  assert.equal(migrations.length, 1, 'Unit 9 migration record');
  assert.ok(migrations[0].finished_at, 'Unit 9 migration finished');
  assert.equal(migrations[0].rolled_back_at, null, 'Unit 9 migration not rolled back');

  const runtimeFunctions = await db.$queryRawUnsafe(
    `SELECT function.proname AS function_name,
            pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
      WHERE namespace.nspname = 'public'
        AND function.proname LIKE 'bootstrap\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('vaultspace_app', function.oid, 'EXECUTE')
      ORDER BY function.proname, identity_arguments`
  );
  assert.deepEqual(
    runtimeFunctions,
    approvedRuntimeFunctions,
    'exact nine-function runtime matrix'
  );

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
       INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
       INNER JOIN pg_catalog.pg_roles AS owner ON owner.oid = function.proowner
       INNER JOIN pg_catalog.pg_language AS language ON language.oid = function.prolang
      WHERE namespace.nspname = 'public'
        AND function.proname = ANY($1::text[])
      ORDER BY function.proname`,
    boundedFunctions.map((fn) => fn.name)
  );
  assert.equal(functions.length, 3, 'bounded function count');
  const expectedAcl = [
    { grantee_name: 'vaultspace_app', privilege_type: 'EXECUTE' },
    { grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' },
  ];
  for (const expected of boundedFunctions) {
    const fn = functions.find((candidate) => candidate.function_name === expected.name);
    assert.ok(fn, expected.name + ': function required');
    assert.equal(fn.identity_arguments, expected.identityArguments, expected.name + ': arguments');
    assert.equal(fn.owner_name, 'vaultspace_bootstrap_owner', expected.name + ': owner');
    assert.equal(fn.language_name, 'sql', expected.name + ': language');
    assert.equal(fn.prosecdef, true, expected.name + ': SECURITY DEFINER');
    assert.equal(fn.provolatile, 'v', expected.name + ': volatility');
    assert.equal(fn.proparallel, 'u', expected.name + ': parallel mode');
    assert.deepEqual(fn.proconfig, ['search_path=pg_catalog'], expected.name + ': search path');
    assert.equal(fn.contract, expected.contract, expected.name + ': contract');
    assert.equal(
      createHash('sha256').update(fn.prosrc).digest('hex'),
      expected.sourceSha256,
      expected.name + ': checksum'
    );
    assert.deepEqual(await functionAcl(expected.signature), expectedAcl, expected.name + ': ACL');
  }

  const ownerOnlyAcl = [{ grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' }];
  for (const signature of genericFunctions) {
    assert.deepEqual(await functionAcl(signature), ownerOnlyAcl, signature + ': owner-only ACL');
  }

  const [posture] = await db.$queryRawUnsafe(
    `SELECT owner.rolcanlogin,
            owner.rolinherit,
            owner.rolsuper,
            owner.rolbypassrls,
            pg_catalog.has_table_privilege(owner.oid, 'public.sessions', 'INSERT') AS table_insert,
            pg_catalog.has_table_privilege(owner.oid, 'public.sessions', 'UPDATE') AS table_update,
            pg_catalog.has_table_privilege(owner.oid, 'public.sessions', 'DELETE') AS table_delete,
            (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_auth_members
              WHERE roleid = owner.oid OR member = owner.oid) AS membership_count,
            pg_catalog.pg_has_role('vaultspace_app', owner.oid, 'MEMBER') AS runtime_reachability
       FROM pg_catalog.pg_roles AS owner
      WHERE owner.rolname = 'vaultspace_bootstrap_owner'`
  );
  assert.deepEqual(posture, {
    rolcanlogin: false,
    rolinherit: false,
    rolsuper: false,
    rolbypassrls: false,
    table_insert: false,
    table_update: false,
    table_delete: false,
    membership_count: 0,
    runtime_reachability: false,
  });

  const policies = await db.$queryRawUnsafe(
    `SELECT policyname, permissive, roles, qual
       FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'user_organizations'
        AND policyname LIKE 'bootstrap_owner_%'`
  );
  assert.deepEqual(policies, [
    {
      policyname: 'bootstrap_owner_membership_inventory',
      permissive: 'PERMISSIVE',
      roles: ['vaultspace_bootstrap_owner'],
      qual: 'true',
    },
  ]);

  const publicFunctions = await db.$queryRawUnsafe(
    `SELECT function.proname
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
      WHERE namespace.nspname = 'public'
        AND function.proname LIKE 'bootstrap\_%' ESCAPE '\'
        AND EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(
            COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
          ) AS acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        )`
  );
  assert.deepEqual(publicFunctions, [], 'PUBLIC denied on every bootstrap function');
}

async function cleanup() {
  try {
    if (fixture.userIds.length > 0) {
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
    if (fixture.organizationIds.length > 0) {
      await db.organization.updateMany({
        where: { id: { in: fixture.organizationIds } },
        data: { isActive: false },
      });
    }
    console.log('PASS  synthetic identities, memberships, sessions, and sibling org soft-disabled');
  } catch {
    console.error('CLEANUP_FAILURE categorical');
    process.exitCode = 1;
  }
}

async function run() {
  let failed = false;
  try {
    await check('health matches the exact Unit 9 release', async () => {
      const health = await request('/api/health');
      expectStatus(health, 200, 'health');
      assert.equal(health.data?.status, 'healthy');
      assert.equal(health.data?.release, expectedRelease);
      assert.equal(health.data?.mode, 'azure');
      assert.deepEqual(health.data?.degraded, []);
      assert.match(health.data?.revision || '', /^ca-vaultspace-web--[0-9]+$/);
    });

    await check(
      'migration, policy, owner posture, checksums, and exact nine-function ACL',
      verifyCatalog
    );

    const cloudVault = await db.organization.findUnique({ where: { slug: organizationSlug } });
    assert.ok(cloudVault, 'CloudVault organization required');
    assert.equal(cloudVault.name, expectedOrganizationName);
    assert.equal(cloudVault.isActive, true);

    const siblingOrganization = await db.organization.create({
      data: {
        name: 'W1-2 Unit 9 Synthetic Sibling',
        slug: 'w12-unit9-sibling-' + suffix,
      },
    });
    fixture.organizationIds.push(siblingOrganization.id);

    const passwordHash = await bcrypt.hash(password, 10);
    const users = {};
    for (const label of ['self', 'admin', 'viewer', 'shared', 'single', 'cross']) {
      const user = await db.user.create({
        data: {
          email: 'w12-unit9-' + label + '-' + suffix + '@example.test',
          passwordHash,
          firstName: 'W1-2',
          lastName: 'Unit 9 ' + label,
          emailVerifiedAt: new Date(),
        },
      });
      users[label] = user;
      fixture.userIds.push(user.id);
    }

    await db.userOrganization.createMany({
      data: [
        { organizationId: cloudVault.id, userId: users.self.id, role: 'VIEWER' },
        { organizationId: cloudVault.id, userId: users.admin.id, role: 'ADMIN' },
        { organizationId: cloudVault.id, userId: users.viewer.id, role: 'VIEWER' },
        { organizationId: cloudVault.id, userId: users.shared.id, role: 'VIEWER' },
        { organizationId: siblingOrganization.id, userId: users.shared.id, role: 'VIEWER' },
        { organizationId: cloudVault.id, userId: users.single.id, role: 'VIEWER' },
        { organizationId: siblingOrganization.id, userId: users.cross.id, role: 'VIEWER' },
      ],
    });

    let selfLogin;
    await check(
      'password change preserves actor and revokes another warmed same-user session',
      async () => {
        selfLogin = await login(users.self.email);
        const other = await createRawSession(users.self.id, cloudVault.id);
        await expectSession(other.cookie, 200, 'other session cache warm');
        const changed = await request('/api/auth/change-password', {
          method: 'POST',
          cookie: selfLogin.cookie,
          body: { currentPassword: password, newPassword },
        });
        expectStatus(changed, 200, 'password change');
        await expectSession(selfLogin.cookie, 200, 'preserved actor session');
        await expectSession(other.cookie, 401, 'revoked other session');
      }
    );

    const adminLogin = await login(users.admin.email);
    await check('admin role change revokes only the target CloudVault session', async () => {
      const targetCloudVault = await createRawSession(users.shared.id, cloudVault.id);
      const targetSibling = await createRawSession(users.shared.id, siblingOrganization.id);
      await expectSession(targetCloudVault.cookie, 200, 'CloudVault target cache warm');
      const changed = await request('/api/users/' + users.shared.id, {
        method: 'PATCH',
        cookie: adminLogin.cookie,
        body: { role: 'ADMIN' },
      });
      expectStatus(changed, 200, 'admin organization change');
      await expectSession(targetCloudVault.cookie, 401, 'CloudVault target revoked');
      await expectSession(targetSibling.cookie, 200, 'sibling organization preserved');
    });

    await check(
      'viewer and cross-organization attempts remain neutral and non-mutating',
      async () => {
        const viewerLogin = await login(users.viewer.email);
        const viewerAttempt = await request('/api/users/' + users.single.id, {
          method: 'PATCH',
          cookie: viewerLogin.cookie,
          body: { role: 'ADMIN' },
        });
        expectStatus(viewerAttempt, 403, 'viewer attempt');

        const crossSession = await createRawSession(users.cross.id, siblingOrganization.id);
        const crossAttempt = await request('/api/users/' + users.cross.id, {
          method: 'PATCH',
          cookie: adminLogin.cookie,
          body: { role: 'ADMIN' },
        });
        expectStatus(crossAttempt, 404, 'cross-organization attempt');
        await expectSession(crossSession.cookie, 200, 'cross-organization target preserved');
      }
    );

    await check(
      'shared identity global change is rejected without revoking either organization',
      async () => {
        const cloudVaultSession = await createRawSession(users.shared.id, cloudVault.id);
        const siblingSession = await createRawSession(users.shared.id, siblingOrganization.id);
        const attempted = await request('/api/users/' + users.shared.id, {
          method: 'PATCH',
          cookie: adminLogin.cookie,
          body: { email: 'w12-unit9-shared-moved-' + suffix + '@example.test' },
        });
        expectStatus(attempted, 403, 'shared identity global change');
        await expectSession(cloudVaultSession.cookie, 200, 'shared CloudVault session preserved');
        await expectSession(siblingSession.cookie, 200, 'shared sibling session preserved');
      }
    );

    await check('single-organization two-factor reset revokes all target sessions', async () => {
      const first = await createRawSession(users.single.id, cloudVault.id);
      const second = await createRawSession(users.single.id, cloudVault.id);
      await expectSession(first.cookie, 200, 'single target cache warm');
      const changed = await request('/api/users/' + users.single.id, {
        method: 'PATCH',
        cookie: adminLogin.cookie,
        body: { resetTwoFactor: true },
      });
      expectStatus(changed, 200, 'single-organization two-factor reset');
      await expectSession(first.cookie, 401, 'single first session revoked');
      await expectSession(second.cookie, 401, 'single second session revoked');
    });

    await check(
      'login, session, organization resolve, logout, and unknown-token regressions stay green',
      async () => {
        const branding = await request('/api/public/branding', {
          headers: { 'x-org-slug': organizationSlug },
        });
        expectStatus(branding, 200, 'CloudVault branding');
        assert.equal(branding.data?.branding?.name, expectedOrganizationName);
        await expectSession(adminLogin.cookie, 200, 'admin session resolve');
        const logout = await request('/api/auth/logout', {
          method: 'POST',
          cookie: adminLogin.cookie,
          body: {},
        });
        expectStatus(logout, 200, 'admin logout');
        await expectSession(adminLogin.cookie, 401, 'post-logout session');
        await expectSession(
          cookieForToken(randomBytes(32).toString('base64url')),
          401,
          'unknown token'
        );
      }
    );

    console.log('SUMMARY PASS ' + results.length + '/' + results.length + ' CloudVault groups');
    console.log('SYNTHETIC_FIXTURE w12-unit9-' + suffix);
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
