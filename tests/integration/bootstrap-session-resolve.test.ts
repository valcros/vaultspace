import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_SESSION_RESOLVE_FUNCTION,
  BootstrapRepository,
  type BootstrapQueryClient,
} from '@/lib/auth/bootstrapRepository';

const OWNER_ROLE = 'vaultspace_bootstrap_owner';
const RUNTIME_ROLE = 'vaultspace_app';
const FUNCTION_NAME = 'bootstrap_session_resolve_v1';
const FUNCTION_SIGNATURE = 'public.bootstrap_session_resolve_v1(text)';
const FUNCTION_CONTRACT_COMMENT = 'vaultspace-contract:w1-2-session-resolve-v1';
const FUNCTION_SOURCE_SHA256 = '7b83946afec28fcb354c53792a714f7c7aef9ca8d2e3953e4aaee3f199a55916';

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

const activeToken = token();
const inactiveSessionToken = token();
const idleExpiredToken = token();
const absoluteExpiredToken = token();
const unboundToken = token();
const inactiveUserToken = token();
const inactiveMembershipToken = token();
const inactiveOrganizationToken = token();

let activeOrganizationId: string;
let inactiveOrganizationId: string;
let activeUserId: string;
let inactiveUserId: string;
let inactiveMembershipUserId: string;
let inactiveOrganizationUserId: string;
let activeSessionId: string;

async function functionExecuteAclRows() {
  return rawPrisma.$queryRawUnsafe<Array<{ grantee_name: string; privilege_type: string }>>(
    "SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE role.rolname END AS grantee_name, " +
      'acl.privilege_type ' +
      'FROM pg_catalog.pg_proc AS function ' +
      'JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace ' +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))) AS acl " +
      'LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee ' +
      "WHERE namespace.nspname = 'public' " +
      "AND function.proname = '" +
      FUNCTION_NAME +
      "' " +
      "AND acl.privilege_type = 'EXECUTE' " +
      'ORDER BY grantee_name'
  );
}

async function withTemporaryRuntimeExecute<T>(
  operation: (repository: BootstrapRepository, tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return rawPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'GRANT EXECUTE ON FUNCTION ' + FUNCTION_SIGNATURE + ' TO ' + RUNTIME_ROLE
    );
    await tx.$executeRawUnsafe('SET LOCAL ROLE ' + RUNTIME_ROLE);

    try {
      const repository = new BootstrapRepository(tx as unknown as BootstrapQueryClient);
      return await operation(repository, tx);
    } finally {
      await tx.$executeRawUnsafe('RESET ROLE');
      await tx.$executeRawUnsafe(
        'REVOKE EXECUTE ON FUNCTION ' + FUNCTION_SIGNATURE + ' FROM ' + RUNTIME_ROLE
      );
    }
  });
}

describe('W1-2 additive session resolve foundation', () => {
  beforeAll(async () => {
    const now = Date.now();
    const activeOrganization = await rawPrisma.organization.create({
      data: {
        name: 'Session Bootstrap Organization',
        slug: 'session-bootstrap-' + suffix,
      },
    });
    activeOrganizationId = activeOrganization.id;

    const inactiveOrganization = await rawPrisma.organization.create({
      data: {
        name: 'Session Bootstrap Inactive Organization',
        slug: 'session-bootstrap-inactive-' + suffix,
        isActive: false,
      },
    });
    inactiveOrganizationId = inactiveOrganization.id;

    const activeUser = await rawPrisma.user.create({
      data: {
        email: 'session-bootstrap-active-' + suffix + '@example.test',
        passwordHash: 'session-bootstrap-hash-' + suffix,
        firstName: 'Session',
        lastName: 'Active',
      },
    });
    activeUserId = activeUser.id;

    const inactiveUser = await rawPrisma.user.create({
      data: {
        email: 'session-bootstrap-inactive-user-' + suffix + '@example.test',
        passwordHash: 'session-bootstrap-hash-' + suffix,
        firstName: 'Session',
        lastName: 'Inactive User',
        isActive: false,
      },
    });
    inactiveUserId = inactiveUser.id;

    const inactiveMembershipUser = await rawPrisma.user.create({
      data: {
        email: 'session-bootstrap-inactive-membership-' + suffix + '@example.test',
        passwordHash: 'session-bootstrap-hash-' + suffix,
        firstName: 'Session',
        lastName: 'Inactive Membership',
      },
    });
    inactiveMembershipUserId = inactiveMembershipUser.id;

    const inactiveOrganizationUser = await rawPrisma.user.create({
      data: {
        email: 'session-bootstrap-inactive-org-' + suffix + '@example.test',
        passwordHash: 'session-bootstrap-hash-' + suffix,
        firstName: 'Session',
        lastName: 'Inactive Organization',
      },
    });
    inactiveOrganizationUserId = inactiveOrganizationUser.id;

    await rawPrisma.userOrganization.createMany({
      data: [
        {
          id: 'session-bootstrap-active-membership-' + suffix,
          userId: activeUserId,
          organizationId: activeOrganizationId,
          role: UserRole.ADMIN,
          canManageUsers: true,
          canManageRooms: false,
        },
        {
          id: 'session-bootstrap-inactive-user-membership-' + suffix,
          userId: inactiveUserId,
          organizationId: activeOrganizationId,
          role: UserRole.VIEWER,
        },
        {
          id: 'session-bootstrap-inactive-membership-' + suffix,
          userId: inactiveMembershipUserId,
          organizationId: activeOrganizationId,
          role: UserRole.VIEWER,
          isActive: false,
        },
        {
          id: 'session-bootstrap-inactive-org-membership-' + suffix,
          userId: inactiveOrganizationUserId,
          organizationId: inactiveOrganizationId,
          role: UserRole.VIEWER,
        },
      ],
    });

    const sessions = await Promise.all([
      rawPrisma.session.create({
        data: {
          userId: activeUserId,
          organizationId: activeOrganizationId,
          token: activeToken,
          createdAt: new Date(now - 60_000),
          lastActiveAt: new Date(now - 30_000),
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
          ipAddress: '192.0.2.10',
          userAgent: 'integration-secret-metadata',
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: activeUserId,
          organizationId: activeOrganizationId,
          token: inactiveSessionToken,
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
          isActive: false,
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: activeUserId,
          organizationId: activeOrganizationId,
          token: idleExpiredToken,
          createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(now - 60_000),
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: activeUserId,
          organizationId: activeOrganizationId,
          token: absoluteExpiredToken,
          createdAt: new Date(now - 8 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: activeUserId,
          organizationId: null,
          token: unboundToken,
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: inactiveUserId,
          organizationId: activeOrganizationId,
          token: inactiveUserToken,
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: inactiveMembershipUserId,
          organizationId: activeOrganizationId,
          token: inactiveMembershipToken,
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: inactiveOrganizationUserId,
          organizationId: inactiveOrganizationId,
          token: inactiveOrganizationToken,
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        },
      }),
    ]);
    activeSessionId = sessions[0]!.id;
  });

  afterAll(async () => {
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
        id: { in: [activeOrganizationId, inactiveOrganizationId].filter(Boolean) },
      },
    });
    await runtimePrisma.$disconnect();
    await rawPrisma.$disconnect();
  });

  it('preserves the exact owner posture and runtime non-reachability', async () => {
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

    const [reachability] = await rawPrisma.$queryRawUnsafe<Array<{ reachable: boolean }>>(
      'SELECT pg_catalog.pg_has_role($1, $2, $3) AS reachable',
      RUNTIME_ROLE,
      OWNER_ROLE,
      'MEMBER'
    );
    expect(reachability?.reachable).toBe(false);
    await expect(runtimePrisma.$executeRawUnsafe('SET ROLE ' + OWNER_ROLE)).rejects.toThrow();
  });

  it('grants the owner only SELECT on the four approved bootstrap tables', async () => {
    const privileges = await rawPrisma.$queryRawUnsafe<
      Array<{ table_name: string; privilege_type: string }>
    >(
      'SELECT table_name, privilege_type FROM information_schema.table_privileges ' +
        'WHERE grantee = $1 ORDER BY table_name, privilege_type',
      OWNER_ROLE
    );
    expect(privileges).toEqual([
      { table_name: 'organizations', privilege_type: 'SELECT' },
      { table_name: 'sessions', privilege_type: 'SELECT' },
      { table_name: 'user_organizations', privilege_type: 'SELECT' },
      { table_name: 'users', privilege_type: 'SELECT' },
    ]);

    const [schemaPrivileges] = await rawPrisma.$queryRawUnsafe<
      Array<{ can_use: boolean; can_create: boolean }>
    >(
      "SELECT has_schema_privilege($1, 'public', 'USAGE') AS can_use, " +
        "has_schema_privilege($1, 'public', 'CREATE') AS can_create",
      OWNER_ROLE
    );
    expect(schemaPrivileges).toEqual({ can_use: true, can_create: false });
  });

  it('installs one exact static function with no PUBLIC or runtime execution', async () => {
    const functions = await rawPrisma.$queryRawUnsafe<
      Array<{
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
      'SELECT pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments, ' +
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
        "WHERE namespace.nspname = 'public' AND function.proname = $1",
      FUNCTION_NAME
    );

    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatchObject({
      identity_arguments: 'input_token text',
      owner_name: OWNER_ROLE,
      language_name: 'sql',
      security_definer: true,
      volatility: 's',
      parallel_mode: 'r',
      configuration: ['search_path=pg_catalog'],
      contract_comment: FUNCTION_CONTRACT_COMMENT,
    });
    expect(functions[0]?.result_type).toContain('session_id text');
    expect(functions[0]?.result_type).toContain('can_manage_rooms boolean');
    expect(functions[0]?.result_type).not.toContain('token');
    expect(functions[0]?.result_type).not.toContain('ip_address');
    expect(functions[0]?.result_type).not.toContain('user_agent');
    expect(functions[0]?.source).not.toMatch(/\bEXECUTE\b/i);
    expect(functions[0]?.source).not.toContain('passwordHash');
    expect(functions[0]?.source).not.toContain('twoFactorSecret');
    expect(functions[0]?.source).not.toContain('twoFactorBackupCodes');
    expect(
      createHash('sha256')
        .update(functions[0]?.source || '')
        .digest('hex')
    ).toBe(FUNCTION_SOURCE_SHA256);

    expect(await functionExecuteAclRows()).toEqual([
      { grantee_name: OWNER_ROLE, privilege_type: 'EXECUTE' },
    ]);

    const [runtimePrivilege] = await rawPrisma.$queryRawUnsafe<Array<{ can_execute: boolean }>>(
      'SELECT pg_catalog.has_function_privilege($1, $2, ' + "'EXECUTE') AS can_execute",
      RUNTIME_ROLE,
      BOOTSTRAP_SESSION_RESOLVE_FUNCTION
    );
    expect(runtimePrivilege?.can_execute).toBe(false);

    await expect(
      runtimePrisma.$queryRawUnsafe(
        'SELECT * FROM ' + FUNCTION_SIGNATURE.replace('(text)', '($1::text)'),
        activeToken
      )
    ).rejects.toThrow();
  });

  it('resolves only the minimal active bound session under a temporary exact grant', async () => {
    await withTemporaryRuntimeExecute(async (repository, tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_catalog.set_config('search_path', 'pg_temp, public', true)"
      );

      const resolved = await repository.resolveSession(activeToken);
      expect(resolved).toMatchObject({
        sessionId: activeSessionId,
        userId: activeUserId,
        organizationId: activeOrganizationId,
        user: {
          id: activeUserId,
          email: 'session-bootstrap-active-' + suffix + '@example.test',
          firstName: 'Session',
          lastName: 'Active',
          isActive: true,
        },
        organization: {
          id: activeOrganizationId,
          name: 'Session Bootstrap Organization',
          slug: 'session-bootstrap-' + suffix,
          role: 'ADMIN',
          canManageUsers: true,
          canManageRooms: false,
        },
      });
      expect(resolved?.createdAt).toBeInstanceOf(Date);
      expect(resolved?.expiresAt).toBeInstanceOf(Date);
      expect(resolved?.lastActiveAt).toBeInstanceOf(Date);
      expect(Object.keys(resolved || {}).sort()).toEqual(
        [
          'createdAt',
          'expiresAt',
          'lastActiveAt',
          'organization',
          'organizationId',
          'sessionId',
          'user',
          'userId',
        ].sort()
      );
      expect(resolved).not.toHaveProperty('token');
      expect(resolved).not.toHaveProperty('ipAddress');
      expect(resolved).not.toHaveProperty('userAgent');

      await expect(repository.resolveSession(token())).resolves.toBeNull();
      await expect(repository.resolveSession(inactiveSessionToken)).resolves.toBeNull();
      await expect(repository.resolveSession(idleExpiredToken)).resolves.toBeNull();
      await expect(repository.resolveSession(absoluteExpiredToken)).resolves.toBeNull();
      await expect(repository.resolveSession(unboundToken)).resolves.toBeNull();
      await expect(repository.resolveSession(inactiveUserToken)).resolves.toBeNull();
      await expect(repository.resolveSession(inactiveMembershipToken)).resolves.toBeNull();
      await expect(repository.resolveSession(inactiveOrganizationToken)).resolves.toBeNull();

      const hostileRows = await tx.$queryRawUnsafe<unknown[]>(
        'SELECT * FROM public.bootstrap_session_resolve_v1($1::text)',
        '\' OR application_session."isActive" IS TRUE --'
      );
      expect(hostileRows).toEqual([]);
    });

    expect(await functionExecuteAclRows()).toEqual([
      { grantee_name: OWNER_ROLE, privilege_type: 'EXECUTE' },
    ]);
  });
});
