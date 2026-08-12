import { createHash, randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_ORGANIZATION_RESOLVE_FUNCTION,
  BootstrapRepository,
  type BootstrapQueryClient,
} from '@/lib/auth/bootstrapRepository';

const OWNER_ROLE = 'vaultspace_bootstrap_owner';
const RUNTIME_ROLE = 'vaultspace_app';
const FUNCTION_NAME = 'bootstrap_organization_resolve_v1';
const FUNCTION_SIGNATURE = 'public.bootstrap_organization_resolve_v1(text, text)';
const FUNCTION_CONTRACT_COMMENT = 'vaultspace-contract:w1-2-organization-resolve-v1';
const FUNCTION_SOURCE_SHA256 = '27cc50a7040e357fc49cb9a838432df9b0a5b9845aa49640acf2a71d4bc14df7';

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
const activeSlug = 'organization-bootstrap-' + suffix;
const activeCustomDomain = 'organization-' + suffix + '.example.test';
const inactiveSlug = 'organization-bootstrap-inactive-' + suffix;
const inactiveCustomDomain = 'inactive-' + suffix + '.example.test';

let activeOrganizationId: string;
let inactiveOrganizationId: string;

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

describe('W1-2 additive organization resolve foundation', () => {
  beforeAll(async () => {
    const activeOrganization = await rawPrisma.organization.create({
      data: {
        name: 'Organization Bootstrap Active',
        slug: activeSlug,
        customDomain: activeCustomDomain,
        logoUrl: 'https://assets.example.test/organization-logo.png',
        primaryColor: '#1a2B3c',
        faviconUrl: 'https://assets.example.test/organization-favicon.ico',
        emailSenderName: 'Protected Sender Name',
        emailSenderAddress: 'protected-sender@example.test',
        eventRetentionDays: 730,
        trashRetentionDays: 60,
      },
    });
    activeOrganizationId = activeOrganization.id;

    const inactiveOrganization = await rawPrisma.organization.create({
      data: {
        name: 'Organization Bootstrap Inactive',
        slug: inactiveSlug,
        customDomain: inactiveCustomDomain,
        isActive: false,
      },
    });
    inactiveOrganizationId = inactiveOrganization.id;
  });

  afterAll(async () => {
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

  it('adds no owner table, sequence, or schema-create privilege', async () => {
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

    const [sequencePrivilege] = await rawPrisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT pg_catalog.count(*) FROM information_schema.usage_privileges ' +
        "WHERE grantee = $1 AND object_type = 'SEQUENCE'",
      OWNER_ROLE
    );
    expect(Number(sequencePrivilege?.count)).toBe(0);
  });

  it('installs one exact static function with owner-only execution', async () => {
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
      identity_arguments: 'input_lookup_kind text, input_lookup_value text',
      owner_name: OWNER_ROLE,
      language_name: 'sql',
      security_definer: true,
      volatility: 's',
      parallel_mode: 'r',
      configuration: ['search_path=pg_catalog'],
      contract_comment: FUNCTION_CONTRACT_COMMENT,
    });
    expect(functions[0]?.result_type).toContain('organization_id text');
    expect(functions[0]?.result_type).toContain('organization_favicon_url text');
    expect(functions[0]?.result_type).not.toContain('email_sender');
    expect(functions[0]?.result_type).not.toContain('retention');
    expect(functions[0]?.result_type).not.toContain('storage');
    expect(functions[0]?.source).not.toMatch(/\bEXECUTE\b/i);
    expect(functions[0]?.source).not.toContain('emailSenderName');
    expect(functions[0]?.source).not.toContain('emailSenderAddress');
    expect(functions[0]?.source).not.toContain('eventRetentionDays');
    expect(functions[0]?.source).not.toContain('maxStorageBytes');
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
      BOOTSTRAP_ORGANIZATION_RESOLVE_FUNCTION
    );
    expect(runtimePrivilege?.can_execute).toBe(false);

    await expect(
      runtimePrisma.$queryRawUnsafe(
        'SELECT * FROM public.bootstrap_organization_resolve_v1($1::text, $2::text)',
        'SLUG',
        activeSlug
      )
    ).rejects.toThrow();
  });

  it('resolves only the active public projection under a temporary exact grant', async () => {
    await withTemporaryRuntimeExecute(async (repository, tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_catalog.set_config('search_path', 'pg_temp, public', true)"
      );

      const expected = {
        id: activeOrganizationId,
        name: 'Organization Bootstrap Active',
        slug: activeSlug,
        customDomain: activeCustomDomain,
        logoUrl: 'https://assets.example.test/organization-logo.png',
        primaryColor: '#1a2B3c',
        faviconUrl: 'https://assets.example.test/organization-favicon.ico',
      };

      await expect(repository.resolveOrganizationBySlug(activeSlug.toUpperCase())).resolves.toEqual(
        expected
      );
      await expect(
        repository.resolveOrganizationByCustomDomain(activeCustomDomain.toUpperCase())
      ).resolves.toEqual(expected);

      expect(Object.keys(expected).sort()).toEqual(
        ['customDomain', 'faviconUrl', 'id', 'logoUrl', 'name', 'primaryColor', 'slug'].sort()
      );
      expect(expected).not.toHaveProperty('emailSenderName');
      expect(expected).not.toHaveProperty('emailSenderAddress');
      expect(expected).not.toHaveProperty('eventRetentionDays');
      expect(expected).not.toHaveProperty('maxStorageBytes');

      await expect(repository.resolveOrganizationBySlug(inactiveSlug)).resolves.toBeNull();
      await expect(
        repository.resolveOrganizationByCustomDomain(inactiveCustomDomain)
      ).resolves.toBeNull();
      await expect(repository.resolveOrganizationBySlug('missing-' + suffix)).resolves.toBeNull();
      await expect(
        repository.resolveOrganizationByCustomDomain('missing-' + suffix + '.example.test')
      ).resolves.toBeNull();

      const invalidKindRows = await tx.$queryRawUnsafe<unknown[]>(
        'SELECT * FROM public.bootstrap_organization_resolve_v1($1::text, $2::text)',
        'UNEXPECTED',
        activeSlug
      );
      expect(invalidKindRows).toEqual([]);

      const crossKindRows = await tx.$queryRawUnsafe<unknown[]>(
        'SELECT * FROM public.bootstrap_organization_resolve_v1($1::text, $2::text)',
        'SLUG',
        activeCustomDomain
      );
      expect(crossKindRows).toEqual([]);

      const hostileRows = await tx.$queryRawUnsafe<unknown[]>(
        'SELECT * FROM public.bootstrap_organization_resolve_v1($1::text, $2::text)',
        'CUSTOM_DOMAIN',
        '\' OR organization."isActive" IS TRUE --'
      );
      expect(hostileRows).toEqual([]);
    });

    expect(await functionExecuteAclRows()).toEqual([
      { grantee_name: OWNER_ROLE, privilege_type: 'EXECUTE' },
    ]);
  });
});
