#!/usr/bin/env node

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS operator runner. */

const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const baseUrl = process.env.QA_BASE_URL;
const organizationSlug = process.env.CLOUDVAULT_ORG_SLUG;
const databaseUrl = process.env.DATABASE_URL_ADMIN;
const expectedRelease = process.env.EXPECTED_RELEASE_SHA;
const expectedOrganizationName = 'CloudVault';
const requiredOrganizationSlug = 'cloudvault-w1-2-verify';
const expectedMigration = '20260813220000_w1_2_password_reset_redemption_route_conversion';
const sessionCookieName = 'vaultspace-session';

const approvedRuntimeFunctions = [
  ['bootstrap_login_candidate_v1', 'input_email text'],
  ['bootstrap_organization_resolve_v1', 'input_lookup_kind text, input_lookup_value text'],
  ['bootstrap_password_reset_candidate_v1', 'input_stored_token text'],
  ['bootstrap_password_reset_redeem_v1', 'input_stored_token text, input_password_hash text'],
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

const passwordResetFunctions = [
  {
    name: 'bootstrap_password_reset_candidate_v1',
    signature: 'public.bootstrap_password_reset_candidate_v1(text)',
    identityArguments: 'input_stored_token text',
    language: 'sql',
    volatility: 's',
    sourceMd5: 'fb2338b2271dcbe38ddb05f4b7a55e65',
    contract: 'vaultspace-contract:w1-2-password-reset-candidate-v1',
  },
  {
    name: 'bootstrap_password_reset_redeem_v1',
    signature: 'public.bootstrap_password_reset_redeem_v1(text, text)',
    identityArguments: 'input_stored_token text, input_password_hash text',
    language: 'plpgsql',
    volatility: 'v',
    sourceMd5: 'be86d46853493dc7dba68cfba0b68c4b',
    contract: 'vaultspace-contract:w1-2-password-reset-redeem-v1',
  },
];

const ownerOnlyFunctions = [
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
const originalPassword = randomBytes(24).toString('base64url');
const replacementPassword = randomBytes(24).toString('base64url');
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

function cookieForToken(token) {
  return sessionCookieName + '=' + token;
}

async function request(path, options = {}) {
  const headers = {
    Accept: options.accept || 'application/json',
    'User-Agent': 'VaultSpace-W1-2-Password-Reset-Route-Acceptance',
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

async function login(email, password) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return {
    ...response,
    cookie: response.status === 200 ? cookieFrom(response.response, sessionCookieName) : null,
  };
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
      userAgent: 'VaultSpace-W1-2-Password-Reset-Route-Acceptance',
    },
  });
  return { ...session, cookie: cookieForToken(rawToken) };
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
    `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = $1`,
    expectedMigration
  );
  assert.equal(migrations.length, 1, 'Unit 11 migration record');
  assert.ok(migrations[0].finished_at, 'Unit 11 migration finished');
  assert.equal(migrations[0].rolled_back_at, null, 'Unit 11 migration not rolled back');
  assert.equal(migrations[0].applied_steps_count, 1, 'Unit 11 migration applied once');

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
  assert.deepEqual(runtimeFunctions, approvedRuntimeFunctions, 'exact eleven-function matrix');

  const functions = await db.$queryRawUnsafe(
    `SELECT function.proname AS function_name,
            pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
            owner.rolname AS owner_name,
            language.lanname AS language_name,
            function.prosecdef,
            function.provolatile,
            function.proparallel,
            function.proconfig,
            pg_catalog.md5(function.prosrc) AS source_md5,
            pg_catalog.obj_description(function.oid, 'pg_proc') AS contract
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
       INNER JOIN pg_catalog.pg_roles AS owner ON owner.oid = function.proowner
       INNER JOIN pg_catalog.pg_language AS language ON language.oid = function.prolang
      WHERE namespace.nspname = 'public'
        AND function.proname = ANY($1::text[])
      ORDER BY function.proname`,
    passwordResetFunctions.map((fn) => fn.name)
  );
  assert.equal(functions.length, 2, 'password-reset function count');
  const expectedAcl = [
    { grantee_name: 'vaultspace_app', privilege_type: 'EXECUTE' },
    { grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' },
  ];
  for (const expected of passwordResetFunctions) {
    const fn = functions.find((candidate) => candidate.function_name === expected.name);
    assert.ok(fn, expected.name + ': function required');
    assert.equal(fn.identity_arguments, expected.identityArguments, expected.name + ': arguments');
    assert.equal(fn.owner_name, 'vaultspace_bootstrap_owner', expected.name + ': owner');
    assert.equal(fn.language_name, expected.language, expected.name + ': language');
    assert.equal(fn.prosecdef, true, expected.name + ': SECURITY DEFINER');
    assert.equal(fn.provolatile, expected.volatility, expected.name + ': volatility');
    assert.equal(fn.proparallel, 'u', expected.name + ': parallel mode');
    assert.deepEqual(fn.proconfig, ['search_path=pg_catalog'], expected.name + ': search path');
    assert.equal(fn.source_md5, expected.sourceMd5, expected.name + ': checksum');
    assert.equal(fn.contract, expected.contract, expected.name + ': contract');
    assert.deepEqual(await functionAcl(expected.signature), expectedAcl, expected.name + ': ACL');
  }

  const ownerOnlyAcl = [{ grantee_name: 'vaultspace_bootstrap_owner', privilege_type: 'EXECUTE' }];
  for (const signature of ownerOnlyFunctions) {
    assert.deepEqual(await functionAcl(signature), ownerOnlyAcl, signature + ': owner-only ACL');
  }

  const [posture] = await db.$queryRawUnsafe(
    `SELECT owner.rolcanlogin,
            owner.rolinherit,
            owner.rolsuper,
            owner.rolbypassrls,
            pg_catalog.has_table_privilege(owner.oid, 'public.password_reset_tokens', 'INSERT, UPDATE, DELETE') AS token_table_write,
            pg_catalog.has_table_privilege(owner.oid, 'public.password_reset_recoveries', 'INSERT, UPDATE, DELETE') AS recovery_table_write,
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
    token_table_write: false,
    recovery_table_write: false,
    membership_count: 0,
    runtime_reachability: false,
  });

  const [residual] = await db.$queryRawUnsafe(
    `SELECT pg_catalog.count(*)::integer AS acl_count
       FROM (
         SELECT 'table:' || privilege.table_name || ':' || privilege.privilege_type AS acl_key
           FROM information_schema.table_privileges AS privilege
          WHERE privilege.table_schema = 'public'
            AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
            AND privilege.grantee = 'vaultspace_app'
         UNION
         SELECT 'column:' || privilege.table_name || '.' || privilege.column_name || ':' || privilege.privilege_type
           FROM information_schema.column_privileges AS privilege
          WHERE privilege.table_schema = 'public'
            AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
            AND privilege.grantee = 'vaultspace_app'
       ) AS runtime_acl`
  );
  assert.equal(residual.acl_count, 152, 'temporary reset-table residual is unchanged');

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
    console.log('PASS  synthetic users, memberships, and sessions soft-disabled');
  } catch {
    console.error('CLEANUP_FAILURE categorical');
    process.exitCode = 1;
  }
}

async function run() {
  let failed = false;
  try {
    await check('health matches the exact Unit 11 release', async () => {
      const health = await request('/api/health');
      expectStatus(health, 200, 'health');
      assert.equal(health.data?.status, 'healthy');
      assert.equal(health.data?.release, expectedRelease);
      assert.equal(health.data?.mode, 'azure');
      assert.deepEqual(health.data?.degraded, []);
      assert.match(health.data?.revision || '', /^ca-vaultspace-web--[0-9]+$/);
    });

    await check('migration, exact eleven-function ACL, owner posture, and residual', verifyCatalog);

    const cloudVault = await db.organization.findUnique({ where: { slug: organizationSlug } });
    assert.ok(cloudVault, 'CloudVault organization required');
    assert.equal(cloudVault.name, expectedOrganizationName);
    assert.equal(cloudVault.isActive, true);

    const initialHash = await bcrypt.hash(originalPassword, 10);
    const subject = await db.user.create({
      data: {
        email: 'w12-unit11-subject-' + suffix + '@example.test',
        passwordHash: initialHash,
        firstName: 'W1-2',
        lastName: 'Unit 11 subject',
        emailVerifiedAt: new Date(),
        organizations: {
          create: { organizationId: cloudVault.id, role: 'VIEWER' },
        },
      },
    });
    const control = await db.user.create({
      data: {
        email: 'w12-unit11-control-' + suffix + '@example.test',
        passwordHash: initialHash,
        firstName: 'W1-2',
        lastName: 'Unit 11 control',
        emailVerifiedAt: new Date(),
        organizations: {
          create: { organizationId: cloudVault.id, role: 'VIEWER' },
        },
      },
    });
    fixture.userIds.push(subject.id, control.id);

    const subjectLogin = await login(subject.email, originalPassword);
    expectStatus(subjectLogin, 200, 'subject login');
    const subjectCookie = subjectLogin.cookie;
    tokenFromCookie(subjectCookie);
    const subjectOtherSession = await createRawSession(subject.id, cloudVault.id);
    const controlLogin = await login(control.email, originalPassword);
    expectStatus(controlLogin, 200, 'control login');

    await check(
      'session resolve, cache warm, and organization resolve regressions are green',
      async () => {
        const me = await expectSession(subjectCookie, 200, 'subject session');
        assert.equal(me.data?.user?.email, subject.email);
        await expectSession(subjectOtherSession.cookie, 200, 'subject secondary cache warm');
        await expectSession(controlLogin.cookie, 200, 'control session');
        const branding = await request('/api/public/branding', {
          headers: { 'x-org-slug': organizationSlug },
        });
        expectStatus(branding, 200, 'CloudVault branding');
        assert.equal(branding.data?.branding?.name, expectedOrganizationName);
      }
    );

    const presentedToken = randomBytes(32).toString('base64url');
    const siblingToken = randomBytes(32).toString('base64url');
    const flow = await db.passwordResetToken.create({
      data: {
        id: randomUUID(),
        userId: subject.id,
        token: presentedToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        requestId: 'w12-unit11-flow-' + suffix,
        deliveryStatus: 'QUEUED',
        auditOrganizationIds: [cloudVault.id],
        recovery: {
          create: {
            userId: subject.id,
            recipientFingerprint: randomBytes(32).toString('hex'),
            cipherVersion: 1,
            keyId: 'w12-unit11-key',
            nonce: Buffer.alloc(12, 1),
            ciphertext: Buffer.alloc(48, 2),
            authTag: Buffer.alloc(16, 3),
            enqueueStatus: 'QUEUED',
            providerOperationId: 'w12-unit11-flow-' + suffix,
          },
        },
      },
    });
    const superseded = await db.passwordResetToken.create({
      data: {
        id: randomUUID(),
        userId: subject.id,
        token: siblingToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        requestId: 'w12-unit11-sibling-' + suffix,
        deliveryStatus: 'QUEUED',
        auditOrganizationIds: [cloudVault.id],
      },
    });

    await check(
      'legacy capability redemption atomically mutates, audits, and revokes sessions',
      async () => {
        const reset = await request('/api/auth/reset-password', {
          method: 'POST',
          body: { token: presentedToken, password: replacementPassword },
        });
        expectStatus(reset, 200, 'password reset');
        assert.deepEqual(reset.data, { success: true });

        const [flowState, siblingState, subjectState, completionAudit, supersessionAudit] =
          await Promise.all([
            db.passwordResetToken.findUniqueOrThrow({
              where: { id: flow.id },
              include: { recovery: true },
            }),
            db.passwordResetToken.findUniqueOrThrow({ where: { id: superseded.id } }),
            db.user.findUniqueOrThrow({ where: { id: subject.id } }),
            db.event.findUnique({
              where: {
                idempotencyKey: 'password-reset-' + flow.id + '-completed-' + cloudVault.id,
              },
            }),
            db.event.findUnique({
              where: {
                idempotencyKey: 'password-reset-' + superseded.id + '-superseded-' + cloudVault.id,
              },
            }),
          ]);
        assert.ok(flowState.usedAt, 'presented flow consumed');
        assert.equal(flowState.recovery?.ciphertext, null, 'presented recovery ciphertext wiped');
        assert.equal(flowState.recovery?.enqueueStatus, 'REDEEMED', 'presented recovery state');
        assert.ok(siblingState.usedAt, 'sibling flow superseded');
        assert.equal(await bcrypt.compare(replacementPassword, subjectState.passwordHash), true);
        assert.equal(completionAudit?.correlationId, flow.id, 'completion audit');
        assert.equal(supersessionAudit?.correlationId, superseded.id, 'supersession audit');
      }
    );

    await check(
      'post-commit cache eviction and live projection deny every revoked session',
      async () => {
        await expectSession(subjectCookie, 401, 'primary subject session revoked');
        await expectSession(subjectOtherSession.cookie, 401, 'secondary warmed session revoked');
        await expectSession(controlLogin.cookie, 200, 'unrelated control session remains active');
      }
    );

    await check(
      'old password fails and replacement password creates a new valid session',
      async () => {
        const oldLogin = await login(subject.email, originalPassword);
        expectStatus(oldLogin, 401, 'old password login');
        const newLogin = await login(subject.email, replacementPassword);
        expectStatus(newLogin, 200, 'replacement password login');
        await expectSession(newLogin.cookie, 200, 'replacement session resolve');
        const logout = await request('/api/auth/logout', {
          method: 'POST',
          cookie: newLogin.cookie,
          body: {},
        });
        expectStatus(logout, 200, 'replacement session logout');
        await expectSession(newLogin.cookie, 401, 'replacement session post-logout');
      }
    );

    await check(
      'used, expired, malformed, and unknown capabilities share one neutral denial',
      async () => {
        const expiredToken = randomBytes(32).toString('base64url');
        await db.passwordResetToken.create({
          data: {
            userId: control.id,
            token: expiredToken,
            expiresAt: new Date(Date.now() - 60_000),
            deliveryStatus: 'QUEUED',
            auditOrganizationIds: [cloudVault.id],
          },
        });
        const cases = [
          presentedToken,
          expiredToken,
          'malformed',
          randomBytes(32).toString('base64url'),
        ];
        for (const token of cases) {
          const denied = await request('/api/auth/reset-password', {
            method: 'POST',
            body: { token, password: replacementPassword },
          });
          expectStatus(denied, 400, 'neutral reset denial');
          assert.deepEqual(denied.data, {
            error: 'Invalid or expired password reset token',
          });
        }
      }
    );

    console.log('SUMMARY PASS ' + results.length + '/' + results.length + ' CloudVault groups');
    console.log('SYNTHETIC_FIXTURE w12-unit11-' + suffix);
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
