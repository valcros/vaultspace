import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { PrismaClient, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER_ROLE = 'vaultspace_bootstrap_owner';
const RUNTIME_ROLE = 'vaultspace_app';
const FUNCTION_NAMES = [
  'bootstrap_session_create_v1',
  'bootstrap_session_refresh_v1',
  'bootstrap_session_invalidate_v1',
  'bootstrap_session_revoke_user_org_v1',
  'bootstrap_session_revoke_user_global_v1',
] as const;

const EXPECTED_FUNCTIONS = [
  {
    name: 'bootstrap_session_create_v1',
    identityArguments:
      'input_user_id text, input_organization_id text, input_token text, input_expires_at timestamp with time zone, input_ip_address text, input_user_agent text',
    comment: 'vaultspace-contract:w1-2-session-create-v1',
    language: 'plpgsql',
  },
  {
    name: 'bootstrap_session_refresh_v1',
    identityArguments: 'input_token text',
    comment: 'vaultspace-contract:w1-2-session-refresh-v1',
    language: 'sql',
  },
  {
    name: 'bootstrap_session_invalidate_v1',
    identityArguments: 'input_token text',
    comment: 'vaultspace-contract:w1-2-session-invalidate-v1',
    language: 'sql',
  },
  {
    name: 'bootstrap_session_revoke_user_org_v1',
    identityArguments: 'input_user_id text, input_organization_id text',
    comment: 'vaultspace-contract:w1-2-session-revoke-user-org-v1',
    language: 'sql',
  },
  {
    name: 'bootstrap_session_revoke_user_global_v1',
    identityArguments: 'input_user_id text, input_preserved_session_id text',
    comment: 'vaultspace-contract:w1-2-session-revoke-user-global-v1',
    language: 'sql',
  },
] as const;

const EXPECTED_FUNCTION_SOURCE_SHA256 = {
  bootstrap_session_create_v1: '184e265aa5787f474582b3d72514e7e9f6f287fcf0bdc0a550680eb65650840c',
  bootstrap_session_refresh_v1: '3e266b4bcba9471926160ed1388524d43ddf8c1936adbedeec3b408b34f0e681',
  bootstrap_session_invalidate_v1:
    '2919babc1fdb1f9ad0fe9678e547e365c3df7df49bba988892589170bdc3e903',
  bootstrap_session_revoke_user_org_v1:
    '7f43a9adde04f440731baeb84eebd3f1740986a22640ad418aa05d2c27194b3d',
  bootstrap_session_revoke_user_global_v1:
    '8ce811e3be405f75f946793c3c6d752a2694ee4b44d66bca878ecd5b5151d35d',
} as const;

const rawPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'],
    },
  },
});

const runtimePrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env['DATABASE_URL'],
    },
  },
});

const suffix = randomUUID();
const token = () => randomBytes(32).toString('base64url');
const functionSourceSha256 = new Map<string, string>();

let organizationAId: string;
let organizationBId: string;
let inactiveOrganizationId: string;
let activeUserId: string;
let inactiveUserId: string;
let inactiveMembershipUserId: string;
let inactiveOrganizationUserId: string;

async function callFunction<T>(sql: string, ...values: unknown[]): Promise<T[]> {
  return rawPrisma.$queryRawUnsafe<T[]>(sql, ...values);
}

async function createRawSession(input: {
  userId?: string;
  organizationId?: string;
  token?: string;
  createdAt?: Date;
  lastActiveAt?: Date;
  expiresAt?: Date;
  isActive?: boolean;
}) {
  const now = Date.now();
  return rawPrisma.session.create({
    data: {
      userId: input.userId || activeUserId,
      organizationId: input.organizationId || organizationAId,
      token: input.token || token(),
      createdAt: input.createdAt || new Date(now - 60_000),
      lastActiveAt: input.lastActiveAt || new Date(now - 60_000),
      expiresAt: input.expiresAt || new Date(now + 24 * 60 * 60 * 1000),
      isActive: input.isActive ?? true,
    },
  });
}

describe('W1-2 inert session mutation foundation', () => {
  beforeAll(async () => {
    const [organizationA, organizationB, inactiveOrganization] = await Promise.all([
      rawPrisma.organization.create({
        data: {
          name: 'Session Mutation Organization A',
          slug: 'session-mutation-a-' + suffix,
        },
      }),
      rawPrisma.organization.create({
        data: {
          name: 'Session Mutation Organization B',
          slug: 'session-mutation-b-' + suffix,
        },
      }),
      rawPrisma.organization.create({
        data: {
          name: 'Session Mutation Inactive Organization',
          slug: 'session-mutation-inactive-' + suffix,
          isActive: false,
        },
      }),
    ]);
    organizationAId = organizationA.id;
    organizationBId = organizationB.id;
    inactiveOrganizationId = inactiveOrganization.id;

    const [activeUser, inactiveUser, inactiveMembershipUser, inactiveOrganizationUser] =
      await Promise.all([
        rawPrisma.user.create({
          data: {
            email: 'session-mutation-active-' + suffix + '@example.test',
            passwordHash: 'session-mutation-hash-' + suffix,
            firstName: 'Session',
            lastName: 'Active',
          },
        }),
        rawPrisma.user.create({
          data: {
            email: 'session-mutation-inactive-' + suffix + '@example.test',
            passwordHash: 'session-mutation-hash-' + suffix,
            firstName: 'Session',
            lastName: 'Inactive',
            isActive: false,
          },
        }),
        rawPrisma.user.create({
          data: {
            email: 'session-mutation-membership-' + suffix + '@example.test',
            passwordHash: 'session-mutation-hash-' + suffix,
            firstName: 'Session',
            lastName: 'Inactive Membership',
          },
        }),
        rawPrisma.user.create({
          data: {
            email: 'session-mutation-organization-' + suffix + '@example.test',
            passwordHash: 'session-mutation-hash-' + suffix,
            firstName: 'Session',
            lastName: 'Inactive Organization',
          },
        }),
      ]);
    activeUserId = activeUser.id;
    inactiveUserId = inactiveUser.id;
    inactiveMembershipUserId = inactiveMembershipUser.id;
    inactiveOrganizationUserId = inactiveOrganizationUser.id;

    await rawPrisma.userOrganization.createMany({
      data: [
        {
          id: 'session-mutation-a-' + suffix,
          userId: activeUserId,
          organizationId: organizationAId,
          role: UserRole.ADMIN,
          canManageUsers: true,
        },
        {
          id: 'session-mutation-b-' + suffix,
          userId: activeUserId,
          organizationId: organizationBId,
          role: UserRole.VIEWER,
        },
        {
          id: 'session-mutation-inactive-user-' + suffix,
          userId: inactiveUserId,
          organizationId: organizationAId,
          role: UserRole.VIEWER,
        },
        {
          id: 'session-mutation-inactive-membership-' + suffix,
          userId: inactiveMembershipUserId,
          organizationId: organizationAId,
          role: UserRole.VIEWER,
          isActive: false,
        },
        {
          id: 'session-mutation-inactive-organization-' + suffix,
          userId: inactiveOrganizationUserId,
          organizationId: inactiveOrganizationId,
          role: UserRole.VIEWER,
        },
      ],
    });
  });

  afterAll(async () => {
    await rawPrisma.session.deleteMany({
      where: {
        userId: {
          in: [
            activeUserId,
            inactiveUserId,
            inactiveMembershipUserId,
            inactiveOrganizationUserId,
          ].filter(Boolean),
        },
      },
    });
    await rawPrisma.user.deleteMany({
      where: {
        id: {
          in: [
            activeUserId,
            inactiveUserId,
            inactiveMembershipUserId,
            inactiveOrganizationUserId,
          ].filter(Boolean),
        },
      },
    });
    await rawPrisma.organization.deleteMany({
      where: {
        id: {
          in: [organizationAId, organizationBId, inactiveOrganizationId].filter(Boolean),
        },
      },
    });
    await runtimePrisma.$disconnect();
    await rawPrisma.$disconnect();
  });

  it('preserves owner posture and adds only exact session column writes', async () => {
    const [role] = await rawPrisma.$queryRawUnsafe<
      Array<{
        rolcanlogin: boolean;
        rolinherit: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
      }>
    >(
      'SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreatedb, ' +
        'rolcreaterole, rolreplication FROM pg_catalog.pg_roles WHERE rolname = $1',
      OWNER_ROLE
    );
    expect(role).toEqual({
      rolcanlogin: false,
      rolinherit: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });

    const tablePrivileges = await rawPrisma.$queryRawUnsafe<
      Array<{ table_name: string; privilege_type: string }>
    >(
      'SELECT table_name, privilege_type FROM information_schema.table_privileges ' +
        'WHERE table_schema = $1 AND grantee = $2 ORDER BY table_name, privilege_type',
      'public',
      OWNER_ROLE
    );
    expect(tablePrivileges).toEqual([
      { table_name: 'organizations', privilege_type: 'SELECT' },
      { table_name: 'sessions', privilege_type: 'SELECT' },
      { table_name: 'user_organizations', privilege_type: 'SELECT' },
      { table_name: 'users', privilege_type: 'SELECT' },
    ]);

    const columnPrivileges = await rawPrisma.$queryRawUnsafe<
      Array<{ column_name: string; privilege_type: string }>
    >(
      'SELECT column_name, privilege_type FROM information_schema.column_privileges ' +
        'WHERE table_schema = $1 AND table_name = $2 AND grantee = $3 ' +
        "AND privilege_type IN ('INSERT', 'UPDATE') ORDER BY column_name, privilege_type",
      'public',
      'sessions',
      OWNER_ROLE
    );
    expect(columnPrivileges).toEqual([
      { column_name: 'createdAt', privilege_type: 'INSERT' },
      { column_name: 'expiresAt', privilege_type: 'INSERT' },
      { column_name: 'expiresAt', privilege_type: 'UPDATE' },
      { column_name: 'id', privilege_type: 'INSERT' },
      { column_name: 'ipAddress', privilege_type: 'INSERT' },
      { column_name: 'isActive', privilege_type: 'INSERT' },
      { column_name: 'isActive', privilege_type: 'UPDATE' },
      { column_name: 'lastActiveAt', privilege_type: 'INSERT' },
      { column_name: 'lastActiveAt', privilege_type: 'UPDATE' },
      { column_name: 'organizationId', privilege_type: 'INSERT' },
      { column_name: 'token', privilege_type: 'INSERT' },
      { column_name: 'updatedAt', privilege_type: 'INSERT' },
      { column_name: 'updatedAt', privilege_type: 'UPDATE' },
      { column_name: 'userAgent', privilege_type: 'INSERT' },
      { column_name: 'userId', privilege_type: 'INSERT' },
    ]);

    const [tableWrites] = await rawPrisma.$queryRawUnsafe<
      Array<{ can_insert: boolean; can_update: boolean; can_delete: boolean }>
    >(
      "SELECT has_table_privilege($1, 'public.sessions', 'INSERT') AS can_insert, " +
        "has_table_privilege($1, 'public.sessions', 'UPDATE') AS can_update, " +
        "has_table_privilege($1, 'public.sessions', 'DELETE') AS can_delete",
      OWNER_ROLE
    );
    expect(tableWrites).toEqual({ can_insert: false, can_update: false, can_delete: false });

    const [reachability] = await rawPrisma.$queryRawUnsafe<Array<{ reachable: boolean }>>(
      'SELECT pg_catalog.pg_has_role($1, $2, $3) AS reachable',
      RUNTIME_ROLE,
      OWNER_ROLE,
      'MEMBER'
    );
    expect(reachability?.reachable).toBe(false);
  });

  it('installs five exact owner-only functions with stable contract markers', async () => {
    const functions = await rawPrisma.$queryRawUnsafe<
      Array<{
        function_name: string;
        identity_arguments: string;
        result_type: string;
        owner_name: string;
        language_name: string;
        security_definer: boolean;
        volatility: string;
        parallel_mode: string;
        configuration: string[];
        source: string;
        contract_comment: string;
      }>
    >(
      'SELECT function.proname AS function_name, ' +
        'pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments, ' +
        'pg_catalog.pg_get_function_result(function.oid) AS result_type, ' +
        'owner.rolname AS owner_name, language.lanname AS language_name, ' +
        'function.prosecdef AS security_definer, function.provolatile AS volatility, ' +
        'function.proparallel AS parallel_mode, function.proconfig AS configuration, ' +
        'function.prosrc AS source, pg_catalog.obj_description(function.oid, ' +
        "'pg_proc') AS contract_comment " +
        'FROM pg_catalog.pg_proc AS function ' +
        'JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace ' +
        'JOIN pg_catalog.pg_roles AS owner ON owner.oid = function.proowner ' +
        'JOIN pg_catalog.pg_language AS language ON language.oid = function.prolang ' +
        "WHERE namespace.nspname = 'public' AND function.proname = ANY($1::text[]) " +
        'ORDER BY function.proname',
      [...FUNCTION_NAMES]
    );

    expect(functions).toHaveLength(5);
    for (const expected of EXPECTED_FUNCTIONS) {
      const functionRow = functions.find((row) => row.function_name === expected.name);
      expect(functionRow).toMatchObject({
        identity_arguments: expected.identityArguments,
        owner_name: OWNER_ROLE,
        language_name: expected.language,
        security_definer: true,
        volatility: 'v',
        parallel_mode: 'u',
        configuration: ['search_path=pg_catalog'],
        contract_comment: expected.comment,
      });
      expect(functionRow?.result_type).not.toContain('token');
      expect(functionRow?.result_type).not.toContain('ip_address');
      expect(functionRow?.result_type).not.toContain('user_agent');
      expect(functionRow?.source).not.toMatch(/\bEXECUTE\b/i);
      functionSourceSha256.set(
        expected.name,
        createHash('sha256')
          .update(functionRow?.source || '')
          .digest('hex')
      );
    }

    const aclRows = await rawPrisma.$queryRawUnsafe<
      Array<{ function_name: string; grantee_name: string; privilege_type: string }>
    >(
      'SELECT function.proname AS function_name, ' +
        "CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE role.rolname END AS grantee_name, " +
        'acl.privilege_type FROM pg_catalog.pg_proc AS function ' +
        'JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace ' +
        "CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))) AS acl " +
        'LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee ' +
        "WHERE namespace.nspname = 'public' AND function.proname = ANY($1::text[]) " +
        "AND acl.privilege_type = 'EXECUTE' ORDER BY function.proname, grantee_name",
      [...FUNCTION_NAMES]
    );
    expect(aclRows).toEqual(
      [...FUNCTION_NAMES].sort().map((functionName) => ({
        function_name: functionName,
        grantee_name: OWNER_ROLE,
        privilege_type: 'EXECUTE',
      }))
    );

    await expect(
      runtimePrisma.$queryRawUnsafe(
        'SELECT * FROM public.bootstrap_session_invalidate_v1($1::text)',
        token()
      )
    ).rejects.toThrow();
  });

  it('creates only an active organization-bound session and returns no raw token', async () => {
    const createdToken = token();
    const created = await callFunction<{
      session_id: string;
      session_created_at: Date;
      session_expires_at: Date;
    }>(
      'SELECT * FROM public.bootstrap_session_create_v1($1::text, $2::text, $3::text, $4::timestamptz, $5::text, $6::text)',
      activeUserId,
      organizationAId,
      createdToken,
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      '192.0.2.10',
      'integration-agent'
    );
    expect(created).toHaveLength(1);
    expect(Object.keys(created[0] || {}).sort()).toEqual(
      ['session_created_at', 'session_expires_at', 'session_id'].sort()
    );
    expect(JSON.stringify(created)).not.toContain(createdToken);

    const stored = await rawPrisma.session.findUniqueOrThrow({ where: { token: createdToken } });
    expect(stored).toMatchObject({
      id: created[0]?.session_id,
      userId: activeUserId,
      organizationId: organizationAId,
      isActive: true,
      ipAddress: '192.0.2.10',
      userAgent: 'integration-agent',
    });

    await expect(
      callFunction(
        'SELECT * FROM public.bootstrap_session_create_v1($1::text, $2::text, $3::text, $4::timestamptz, NULL, NULL)',
        inactiveUserId,
        organizationAId,
        token(),
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      )
    ).resolves.toEqual([]);
    await expect(
      callFunction(
        'SELECT * FROM public.bootstrap_session_create_v1($1::text, $2::text, $3::text, $4::timestamptz, NULL, NULL)',
        "' OR true --",
        organizationAId,
        token(),
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      )
    ).resolves.toEqual([]);
    await expect(
      callFunction(
        'SELECT * FROM public.bootstrap_session_create_v1($1::text, $2::text, $3::text, $4::timestamptz, NULL, NULL)',
        activeUserId,
        organizationAId,
        token(),
        new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
      )
    ).resolves.toEqual([]);
    await expect(
      callFunction(
        'SELECT * FROM public.bootstrap_session_create_v1($1::text, $2::text, $3::text, $4::timestamptz, NULL, NULL)',
        inactiveMembershipUserId,
        organizationAId,
        token(),
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      )
    ).resolves.toEqual([]);
    await expect(
      callFunction(
        'SELECT * FROM public.bootstrap_session_create_v1($1::text, $2::text, $3::text, $4::timestamptz, NULL, NULL)',
        inactiveOrganizationUserId,
        inactiveOrganizationId,
        token(),
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      )
    ).resolves.toEqual([]);
    await expect(
      callFunction(
        'SELECT * FROM public.bootstrap_session_create_v1($1::text, $2::text, $3::text, $4::timestamptz, NULL, NULL)',
        activeUserId,
        organizationAId,
        createdToken,
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      )
    ).resolves.toEqual([]);
  });

  it('refreshes only a due, valid session and cannot resurrect expired state', async () => {
    const dueToken = token();
    const dueSession = await createRawSession({
      token: dueToken,
      lastActiveAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    const refreshed = await callFunction<{ session_id: string; session_expires_at: Date }>(
      'SELECT * FROM public.bootstrap_session_refresh_v1($1::text)',
      dueToken
    );
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.session_id).toBe(dueSession.id);

    const notDueToken = token();
    await createRawSession({ token: notDueToken, lastActiveAt: new Date() });
    await expect(
      callFunction('SELECT * FROM public.bootstrap_session_refresh_v1($1::text)', notDueToken)
    ).resolves.toEqual([]);

    const expiredToken = token();
    await createRawSession({ token: expiredToken, expiresAt: new Date(Date.now() - 60_000) });
    await expect(
      callFunction('SELECT * FROM public.bootstrap_session_refresh_v1($1::text)', expiredToken)
    ).resolves.toEqual([]);

    const absoluteExpiredToken = token();
    await createRawSession({
      token: absoluteExpiredToken,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      lastActiveAt: new Date(Date.now() - 6 * 60 * 1000),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await expect(
      callFunction(
        'SELECT * FROM public.bootstrap_session_refresh_v1($1::text)',
        absoluteExpiredToken
      )
    ).resolves.toEqual([]);

    const inactiveMembershipToken = token();
    await createRawSession({
      userId: inactiveMembershipUserId,
      token: inactiveMembershipToken,
      lastActiveAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    await expect(
      callFunction(
        'SELECT * FROM public.bootstrap_session_refresh_v1($1::text)',
        inactiveMembershipToken
      )
    ).resolves.toEqual([]);

    await rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_catalog.set_config('search_path', 'pg_temp, public', true)"
      );
      await expect(
        tx.$queryRawUnsafe('SELECT * FROM public.bootstrap_session_refresh_v1($1::text)', token())
      ).resolves.toEqual([]);
    });
  });

  it('invalidates one session even after its membership becomes inactive', async () => {
    const logoutToken = token();
    const session = await createRawSession({
      userId: inactiveMembershipUserId,
      token: logoutToken,
    });

    const invalidated = await callFunction<{ session_id: string }>(
      'SELECT * FROM public.bootstrap_session_invalidate_v1($1::text)',
      logoutToken
    );
    expect(invalidated).toEqual([{ session_id: session.id }]);
    expect(await rawPrisma.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      isActive: false,
    });
    await expect(
      callFunction('SELECT * FROM public.bootstrap_session_invalidate_v1($1::text)', logoutToken)
    ).resolves.toEqual([]);
  });

  it('revokes only the selected organization and returns session IDs', async () => {
    const [sessionA1, sessionA2, sessionB] = await Promise.all([
      createRawSession({ organizationId: organizationAId }),
      createRawSession({ organizationId: organizationAId }),
      createRawSession({ organizationId: organizationBId }),
    ]);

    const revoked = await callFunction<{ session_id: string }>(
      'SELECT * FROM public.bootstrap_session_revoke_user_org_v1($1::text, $2::text)',
      activeUserId,
      organizationAId
    );
    expect(revoked.map((row) => row.session_id)).toEqual(
      expect.arrayContaining([sessionA1.id, sessionA2.id])
    );
    expect(revoked.map((row) => row.session_id)).not.toContain(sessionB.id);
    expect(await rawPrisma.session.findUniqueOrThrow({ where: { id: sessionB.id } })).toMatchObject(
      {
        isActive: true,
      }
    );
  });

  it('supports global revoke with preserve-one and revoke-all composition', async () => {
    const preserved = await createRawSession({ organizationId: organizationBId });
    const revoked = await createRawSession({ organizationId: organizationBId });

    const firstPass = await callFunction<{ session_id: string }>(
      'SELECT * FROM public.bootstrap_session_revoke_user_global_v1($1::text, $2::text)',
      activeUserId,
      preserved.id
    );
    expect(firstPass.map((row) => row.session_id)).toContain(revoked.id);
    expect(firstPass.map((row) => row.session_id)).not.toContain(preserved.id);
    expect(
      await rawPrisma.session.findUniqueOrThrow({ where: { id: preserved.id } })
    ).toMatchObject({ isActive: true });

    const secondPass = await callFunction<{ session_id: string }>(
      'SELECT * FROM public.bootstrap_session_revoke_user_global_v1($1::text, NULL)',
      activeUserId
    );
    expect(secondPass.map((row) => row.session_id)).toContain(preserved.id);
  });

  it('matches the reviewed source fingerprints without exposing function input data', () => {
    expect(Object.fromEntries(functionSourceSha256)).toEqual(EXPECTED_FUNCTION_SOURCE_SHA256);
  });
});
