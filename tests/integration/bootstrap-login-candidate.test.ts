import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_LOGIN_CANDIDATE_FUNCTION,
  BootstrapRepository,
} from '@/lib/auth/bootstrapRepository';

const OWNER_ROLE = 'vaultspace_bootstrap_owner';
const RUNTIME_ROLE = 'vaultspace_app';
const FUNCTION_NAME = 'bootstrap_login_candidate_v1';
const FUNCTION_CONTRACT_COMMENT = 'vaultspace-contract:w1-2-login-candidate-v1';
const FUNCTION_SOURCE_SHA256 = '72b12f72ab12ca301cce0b168463dd294df01fa2c0ca1e07b8668643b267db38';

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
const activeEmail = 'bootstrap-active-' + suffix + '@example.test';
const inactiveUserEmail = 'bootstrap-inactive-user-' + suffix + '@example.test';
const inactiveMembershipEmail = 'bootstrap-inactive-membership-' + suffix + '@example.test';
const inactiveOrganizationEmail = 'bootstrap-inactive-org-' + suffix + '@example.test';
const passwordHash = 'bootstrap-integration-hash-' + suffix;

let firstOrganizationId: string;
let secondOrganizationId: string;
let inactiveOrganizationId: string;
let activeUserId: string;
let inactiveUserId: string;
let inactiveMembershipUserId: string;
let inactiveOrganizationUserId: string;

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

describe('W1-2 routed login bootstrap candidate', () => {
  beforeAll(async () => {
    const firstOrganization = await rawPrisma.organization.create({
      data: {
        name: 'Bootstrap First Organization',
        slug: 'bootstrap-first-' + suffix,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    firstOrganizationId = firstOrganization.id;

    const secondOrganization = await rawPrisma.organization.create({
      data: {
        name: 'Bootstrap Second Organization',
        slug: 'bootstrap-second-' + suffix,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    secondOrganizationId = secondOrganization.id;

    const inactiveOrganization = await rawPrisma.organization.create({
      data: {
        name: 'Bootstrap Inactive Organization',
        slug: 'bootstrap-inactive-' + suffix,
        isActive: false,
      },
    });
    inactiveOrganizationId = inactiveOrganization.id;

    const activeUser = await rawPrisma.user.create({
      data: {
        email: activeEmail,
        passwordHash,
        firstName: 'Active',
        lastName: 'Candidate',
        twoFactorEnabled: true,
      },
    });
    activeUserId = activeUser.id;

    const inactiveUser = await rawPrisma.user.create({
      data: {
        email: inactiveUserEmail,
        passwordHash,
        firstName: 'Inactive',
        lastName: 'User',
        isActive: false,
      },
    });
    inactiveUserId = inactiveUser.id;

    const inactiveMembershipUser = await rawPrisma.user.create({
      data: {
        email: inactiveMembershipEmail,
        passwordHash,
        firstName: 'Inactive',
        lastName: 'Membership',
      },
    });
    inactiveMembershipUserId = inactiveMembershipUser.id;

    const inactiveOrganizationUser = await rawPrisma.user.create({
      data: {
        email: inactiveOrganizationEmail,
        passwordHash,
        firstName: 'Inactive',
        lastName: 'Organization',
      },
    });
    inactiveOrganizationUserId = inactiveOrganizationUser.id;

    await rawPrisma.userOrganization.createMany({
      data: [
        {
          id: 'bootstrap-membership-first-' + suffix,
          userId: activeUserId,
          organizationId: firstOrganizationId,
          role: UserRole.VIEWER,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
        {
          id: 'bootstrap-membership-second-' + suffix,
          userId: activeUserId,
          organizationId: secondOrganizationId,
          role: UserRole.ADMIN,
          createdAt: new Date('2026-02-02T00:00:00.000Z'),
        },
        {
          id: 'bootstrap-membership-inactive-user-' + suffix,
          userId: inactiveUserId,
          organizationId: firstOrganizationId,
          role: UserRole.VIEWER,
        },
        {
          id: 'bootstrap-membership-inactive-' + suffix,
          userId: inactiveMembershipUserId,
          organizationId: firstOrganizationId,
          role: UserRole.VIEWER,
          isActive: false,
        },
        {
          id: 'bootstrap-membership-inactive-org-' + suffix,
          userId: inactiveOrganizationUserId,
          organizationId: inactiveOrganizationId,
          role: UserRole.VIEWER,
        },
      ],
    });
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
        id: {
          in: [firstOrganizationId, secondOrganizationId, inactiveOrganizationId].filter(Boolean),
        },
      },
    });
    await runtimePrisma.$disconnect();
    await rawPrisma.$disconnect();
  });

  it('creates the exact NOLOGIN and NOBYPASSRLS owner posture', async () => {
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
  });

  it('keeps the owner unreachable from the runtime role', async () => {
    const [reachability] = await rawPrisma.$queryRawUnsafe<Array<{ reachable: boolean }>>(
      'WITH RECURSIVE membership_closure(roleid) AS (' +
        ' SELECT membership.roleid FROM pg_catalog.pg_auth_members AS membership' +
        ' JOIN pg_catalog.pg_roles AS runtime ON runtime.oid = membership.member AND runtime.rolname = $1' +
        ' UNION' +
        ' SELECT membership.roleid FROM pg_catalog.pg_auth_members AS membership' +
        ' JOIN membership_closure AS inherited ON inherited.roleid = membership.member' +
        ')' +
        ' SELECT EXISTS (' +
        ' SELECT 1 FROM membership_closure' +
        ' JOIN pg_catalog.pg_roles AS reachable_role ON reachable_role.oid = membership_closure.roleid' +
        ' WHERE reachable_role.rolname = $2' +
        ') AS reachable',
      RUNTIME_ROLE,
      OWNER_ROLE
    );

    expect(reachability?.reachable).toBe(false);
    await expect(runtimePrisma.$executeRawUnsafe('SET ROLE ' + OWNER_ROLE)).rejects.toThrow();
  });

  it('grants only schema usage and SELECT on the four approved bootstrap tables', async () => {
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

  it('installs only the three active-row owner policies', async () => {
    const policies = await rawPrisma.$queryRawUnsafe<
      Array<{
        tablename: string;
        policyname: string;
        permissive: string;
        roles: string[];
        cmd: string;
        qual: string;
      }>
    >(
      'SELECT tablename, policyname, permissive, roles, cmd, qual FROM pg_catalog.pg_policies ' +
        "WHERE schemaname = 'public' AND policyname LIKE 'bootstrap_owner_%_login_lookup' " +
        'ORDER BY tablename'
    );

    expect(policies).toEqual([
      {
        tablename: 'organizations',
        policyname: 'bootstrap_owner_active_organization_login_lookup',
        permissive: 'RESTRICTIVE',
        roles: [OWNER_ROLE],
        cmd: 'SELECT',
        qual: '("isActive" IS TRUE)',
      },
      {
        tablename: 'user_organizations',
        policyname: 'bootstrap_owner_active_membership_login_lookup',
        permissive: 'RESTRICTIVE',
        roles: [OWNER_ROLE],
        cmd: 'SELECT',
        qual: '("isActive" IS TRUE)',
      },
      {
        tablename: 'users',
        policyname: 'bootstrap_owner_active_user_login_lookup',
        permissive: 'RESTRICTIVE',
        roles: [OWNER_ROLE],
        cmd: 'SELECT',
        qual: '("isActive" IS TRUE)',
      },
    ]);
  });

  it('installs one exact static function with only owner and runtime execution', async () => {
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
      identity_arguments: 'input_email text',
      owner_name: OWNER_ROLE,
      language_name: 'sql',
      security_definer: true,
      volatility: 's',
      parallel_mode: 'r',
      configuration: ['search_path=pg_catalog'],
      contract_comment: FUNCTION_CONTRACT_COMMENT,
    });
    expect(functions[0]?.result_type).toContain('user_id text');
    expect(functions[0]?.result_type).toContain('organization_role text');
    expect(functions[0]?.source).not.toMatch(/\bEXECUTE\b/i);
    expect(functions[0]?.source).not.toContain('twoFactorSecret');
    expect(functions[0]?.source).not.toContain('twoFactorBackupCodes');
    expect(
      createHash('sha256')
        .update(functions[0]?.source || '')
        .digest('hex')
    ).toBe(FUNCTION_SOURCE_SHA256);

    expect(await functionExecuteAclRows()).toEqual([
      { grantee_name: RUNTIME_ROLE, privilege_type: 'EXECUTE' },
      { grantee_name: OWNER_ROLE, privilege_type: 'EXECUTE' },
    ]);

    const [runtimePrivilege] = await rawPrisma.$queryRawUnsafe<Array<{ can_execute: boolean }>>(
      'SELECT pg_catalog.has_function_privilege($1, $2, ' + "'EXECUTE') AS can_execute",
      RUNTIME_ROLE,
      BOOTSTRAP_LOGIN_CANDIDATE_FUNCTION
    );
    expect(runtimePrivilege?.can_execute).toBe(true);

    const [otherPrivileges] = await rawPrisma.$queryRawUnsafe<
      Array<{ session_execute: boolean; organization_execute: boolean }>
    >(
      `SELECT
         pg_catalog.has_function_privilege(
           $1, 'public.bootstrap_session_resolve_v1(text)', 'EXECUTE'
         ) AS session_execute,
         pg_catalog.has_function_privilege(
           $1, 'public.bootstrap_organization_resolve_v1(text, text)', 'EXECUTE'
         ) AS organization_execute`,
      RUNTIME_ROLE
    );
    expect(otherPrivileges).toEqual({
      session_execute: true,
      organization_execute: true,
    });
  });

  it('resolves only the deterministic minimal active candidate as the runtime role', async () => {
    const repository = new BootstrapRepository(runtimePrisma);
    const candidate = await repository.findLoginCandidate('  ' + activeEmail.toUpperCase() + ' ');
    expect(candidate).toEqual({
      userId: activeUserId,
      email: activeEmail,
      firstName: 'Active',
      lastName: 'Candidate',
      passwordHash,
      userIsActive: true,
      twoFactorEnabled: true,
      organizationId: firstOrganizationId,
      organizationName: 'Bootstrap First Organization',
      organizationSlug: 'bootstrap-first-' + suffix,
      organizationRole: 'VIEWER',
    });
    expect(Object.keys(candidate || {}).sort()).toEqual(
      [
        'email',
        'firstName',
        'lastName',
        'organizationId',
        'organizationName',
        'organizationRole',
        'organizationSlug',
        'passwordHash',
        'twoFactorEnabled',
        'userId',
        'userIsActive',
      ].sort()
    );

    await expect(
      repository.findLoginCandidate('missing-' + suffix + '@example.test')
    ).resolves.toBeNull();
    await expect(repository.findLoginCandidate(inactiveUserEmail)).resolves.toBeNull();
    await expect(repository.findLoginCandidate(inactiveMembershipEmail)).resolves.toBeNull();
    await expect(repository.findLoginCandidate(inactiveOrganizationEmail)).resolves.toBeNull();
    await expect(
      repository.findLoginCandidate('\' OR candidate_user."isActive" IS TRUE --')
    ).resolves.toBeNull();

    expect(await functionExecuteAclRows()).toEqual([
      { grantee_name: RUNTIME_ROLE, privilege_type: 'EXECUTE' },
      { grantee_name: OWNER_ROLE, privilege_type: 'EXECUTE' },
    ]);
  });

  it('enforces active-row policies when operating directly as the NOLOGIN owner', async () => {
    await rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE ' + OWNER_ROLE);
      const users = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT id FROM public.users WHERE id = ANY($1::text[]) ORDER BY id',
        [activeUserId, inactiveUserId]
      );
      expect(users).toEqual([{ id: activeUserId }]);
      await tx.$executeRawUnsafe('RESET ROLE');
    });
  });
});
