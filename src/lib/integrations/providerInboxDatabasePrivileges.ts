import type { PrismaClient } from '@prisma/client';

export class ProviderInboxPrivilegeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ProviderInboxPrivilegeError';
  }
}

async function revokeAndVerifyProtectedTableAccess(
  client: PrismaClient,
  applicationRole: string,
  tableName: 'provider_event_inbox' | 'password_reset_provider_correlations',
  errorPrefix: 'PROVIDER_INBOX' | 'PASSWORD_RESET_PROVIDER_CORRELATION'
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(applicationRole)) {
    throw new ProviderInboxPrivilegeError(`${errorPrefix}_APPLICATION_ROLE_INVALID`);
  }
  await client.$executeRawUnsafe(
    `REVOKE ALL PRIVILEGES ON public.${tableName} FROM ${applicationRole}`
  );
  const [access] = await client.$queryRawUnsafe<
    Array<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
      can_references: boolean;
      can_trigger: boolean;
      has_column_privilege: boolean;
      is_owner: boolean;
      reachable_roles: string[];
    }>
  >(`
    SELECT has_table_privilege('${applicationRole}', 'public.${tableName}', 'SELECT') AS can_select,
           has_table_privilege('${applicationRole}', 'public.${tableName}', 'INSERT') AS can_insert,
           has_table_privilege('${applicationRole}', 'public.${tableName}', 'UPDATE') AS can_update,
           has_table_privilege('${applicationRole}', 'public.${tableName}', 'DELETE') AS can_delete,
           has_table_privilege('${applicationRole}', 'public.${tableName}', 'TRUNCATE') AS can_truncate,
           has_table_privilege('${applicationRole}', 'public.${tableName}', 'REFERENCES') AS can_references,
           has_table_privilege('${applicationRole}', 'public.${tableName}', 'TRIGGER') AS can_trigger,
           has_any_column_privilege(
             '${applicationRole}',
             'public.${tableName}',
             'SELECT,INSERT,UPDATE,REFERENCES'
           ) AS has_column_privilege,
           pg_get_userbyid(c.relowner) = '${applicationRole}' AS is_owner,
           ARRAY(
             SELECT reachable.rolname
             FROM pg_roles reachable
             WHERE reachable.rolname <> '${applicationRole}'
               AND pg_has_role('${applicationRole}', reachable.oid, 'MEMBER')
             ORDER BY reachable.rolname
           ) AS reachable_roles
    FROM pg_class c
    WHERE c.oid = 'public.${tableName}'::regclass
  `);
  if (
    !access ||
    access.can_select ||
    access.can_insert ||
    access.can_update ||
    access.can_delete ||
    access.can_truncate ||
    access.can_references ||
    access.can_trigger ||
    access.has_column_privilege ||
    access.is_owner ||
    access.reachable_roles.length > 0
  ) {
    throw new ProviderInboxPrivilegeError(`${errorPrefix}_APPLICATION_ROLE_ACCESS_REMAINS`);
  }
}

/** Revoke and then prove that an ordinary runtime role has no inbox access. */
export async function revokeAndVerifyProviderInboxAccess(
  client: PrismaClient,
  applicationRole: string
): Promise<void> {
  await revokeAndVerifyProtectedTableAccess(
    client,
    applicationRole,
    'provider_event_inbox',
    'PROVIDER_INBOX'
  );
}

/** Revoke and prove that a runtime role cannot reach raw ACS correlations. */
export async function revokeAndVerifyPasswordResetProviderCorrelationAccess(
  client: PrismaClient,
  applicationRole: string
): Promise<void> {
  await revokeAndVerifyProtectedTableAccess(
    client,
    applicationRole,
    'password_reset_provider_correlations',
    'PASSWORD_RESET_PROVIDER_CORRELATION'
  );
  // Remove every non-owner grant on both reviewed signatures and any
  // protected-name overload before granting the one aggregate-only contract.
  // This also retires access held by a previously configured runtime role.
  await client.$executeRawUnsafe(`
    DO $$
    DECLARE
      granted_function record;
    BEGIN
      FOR granted_function IN
        SELECT DISTINCT
          namespace.nspname AS schema_name,
          function.proname AS function_name,
          pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
          acl.grantee AS grantee_oid,
          grantee.rolname AS grantee_name
        FROM pg_catalog.pg_proc function
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = 'public'
          AND function.proname IN (
            'password_reset_provider_correlation_source_valid',
            'password_reset_provider_correlation_eligible',
            'register_password_reset_provider_correlation',
            'prevent_password_reset_provider_correlation_change',
            'prevent_registered_password_reset_identity_change',
            'password_reset_provider_correlation_preflight_counts'
          )
          AND acl.grantee <> function.proowner
      LOOP
        IF granted_function.grantee_oid = 0 THEN
          EXECUTE format(
            'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC',
            granted_function.schema_name,
            granted_function.function_name,
            granted_function.identity_arguments
          );
        ELSE
          EXECUTE format(
            'REVOKE ALL ON FUNCTION %I.%I(%s) FROM %I',
            granted_function.schema_name,
            granted_function.function_name,
            granted_function.identity_arguments,
            granted_function.grantee_name
          );
        END IF;
      END LOOP;
    END
    $$;
  `);
  await client.$executeRawUnsafe(
    `GRANT EXECUTE ON FUNCTION public.password_reset_provider_correlation_preflight_counts() TO ${applicationRole}`
  );
  const [functions] = await client.$queryRawUnsafe<
    Array<{
      can_execute_counts: boolean;
      sensitive_execute_count: number;
      public_execute_count: number;
      missing_expected_function_count: number;
      unexpected_overload_count: number;
      unexpected_acl_count: number;
    }>
  >(`
    WITH expected(signature) AS (
      VALUES
        ('public.password_reset_provider_correlation_source_valid(public.password_reset_tokens,public.password_reset_recoveries)'),
        ('public.password_reset_provider_correlation_eligible(public.password_reset_tokens,public.password_reset_recoveries)'),
        ('public.register_password_reset_provider_correlation()'),
        ('public.prevent_password_reset_provider_correlation_change()'),
        ('public.prevent_registered_password_reset_identity_change()'),
        ('public.password_reset_provider_correlation_preflight_counts()')
    )
    SELECT has_function_privilege(
             '${applicationRole}',
             'public.password_reset_provider_correlation_preflight_counts()',
             'EXECUTE'
           ) AS can_execute_counts,
           (
             SELECT count(*)::int
             FROM pg_proc function
             JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
             WHERE namespace.nspname = 'public'
               AND function.proname IN (
                 'password_reset_provider_correlation_source_valid',
                 'password_reset_provider_correlation_eligible',
                 'register_password_reset_provider_correlation',
                 'prevent_password_reset_provider_correlation_change',
                 'prevent_registered_password_reset_identity_change',
                 'password_reset_provider_correlation_preflight_counts'
               )
               AND function.oid IS DISTINCT FROM
                 'public.password_reset_provider_correlation_preflight_counts()'::regprocedure
               AND has_function_privilege('${applicationRole}', function.oid, 'EXECUTE')
           ) AS sensitive_execute_count,
           (
             SELECT count(*)::int
             FROM pg_proc function
             JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
             CROSS JOIN LATERAL aclexplode(
               COALESCE(function.proacl, acldefault('f', function.proowner))
             ) acl
             WHERE namespace.nspname = 'public'
               AND function.proname IN (
                 'password_reset_provider_correlation_source_valid',
                 'password_reset_provider_correlation_eligible',
                 'register_password_reset_provider_correlation',
                 'prevent_password_reset_provider_correlation_change',
                 'prevent_registered_password_reset_identity_change',
                 'password_reset_provider_correlation_preflight_counts'
               )
               AND acl.grantee = 0
               AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute_count,
           (
             SELECT count(*)::int
             FROM expected
             WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL
           ) AS missing_expected_function_count,
           (
             SELECT count(*)::int
             FROM pg_proc function
             JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
             WHERE namespace.nspname = 'public'
               AND function.proname IN (
                 'password_reset_provider_correlation_source_valid',
                 'password_reset_provider_correlation_eligible',
                 'register_password_reset_provider_correlation',
                 'prevent_password_reset_provider_correlation_change',
                 'prevent_registered_password_reset_identity_change',
                 'password_reset_provider_correlation_preflight_counts'
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM expected
                 WHERE pg_catalog.to_regprocedure(expected.signature) = function.oid
               )
           ) AS unexpected_overload_count,
           (
             SELECT count(*)::int
             FROM pg_proc function
             JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
             CROSS JOIN LATERAL aclexplode(
               COALESCE(function.proacl, acldefault('f', function.proowner))
             ) acl
             WHERE namespace.nspname = 'public'
               AND function.proname IN (
                 'password_reset_provider_correlation_source_valid',
                 'password_reset_provider_correlation_eligible',
                 'register_password_reset_provider_correlation',
                 'prevent_password_reset_provider_correlation_change',
                 'prevent_registered_password_reset_identity_change',
                 'password_reset_provider_correlation_preflight_counts'
               )
               AND acl.grantee <> function.proowner
               AND NOT (
                 function.oid =
                   'public.password_reset_provider_correlation_preflight_counts()'::regprocedure
                 AND acl.grantee = (
                   SELECT role.oid FROM pg_roles role WHERE role.rolname = '${applicationRole}'
                 )
                 AND acl.privilege_type = 'EXECUTE'
                 AND NOT acl.is_grantable
               )
           ) AS unexpected_acl_count
  `);
  if (
    !functions?.can_execute_counts ||
    functions.sensitive_execute_count !== 0 ||
    functions.public_execute_count !== 0 ||
    functions.missing_expected_function_count !== 0 ||
    functions.unexpected_overload_count !== 0 ||
    functions.unexpected_acl_count !== 0
  ) {
    throw new ProviderInboxPrivilegeError(
      'PASSWORD_RESET_PROVIDER_CORRELATION_FUNCTION_ACCESS_INVALID'
    );
  }
}
