import type { PrismaClient } from '@prisma/client';

/** Global tables that are unavailable to the ordinary tenant runtime role. */
export const PLATFORM_CONTROL_TABLES = [
  'platform_sessions',
  'platform_capability_grants',
  'platform_audit_events',
] as const;

/** Authentication control-plane state that has no direct runtime table path. */
export const TWO_FACTOR_AUTH_TABLES = ['two_factor_login_challenges'] as const;

const RESTRICTED_CONTROL_TABLES = [...PLATFORM_CONTROL_TABLES, ...TWO_FACTOR_AUTH_TABLES] as const;

export class PlatformControlPrivilegeError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/**
 * Revoke and prove the ordinary application role has no direct route to the
 * global platform-control tables. This must run after any broad all-tables
 * grant, including disposable RLS-test setup.
 */
export async function revokeAndVerifyPlatformControlPlaneAccess(
  client: PrismaClient,
  applicationRole: string
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(applicationRole)) {
    throw new PlatformControlPrivilegeError('PLATFORM_CONTROL_APPLICATION_ROLE_INVALID');
  }

  for (const table of RESTRICTED_CONTROL_TABLES) {
    await client.$executeRawUnsafe(
      `REVOKE ALL PRIVILEGES ON public.${table} FROM ${applicationRole}`
    );
    await client.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON public.${table} FROM PUBLIC`);
  }
  await client.$executeRawUnsafe(
    `REVOKE ALL PRIVILEGES ON SEQUENCE public.platform_audit_events_sequence_seq FROM ${applicationRole}`
  );
  await client.$executeRawUnsafe(
    `REVOKE ALL PRIVILEGES ON SEQUENCE public.platform_audit_events_sequence_seq FROM PUBLIC`
  );

  const [access] = await client.$queryRawUnsafe<
    Array<{
      table_privilege_remains: boolean;
      column_privilege_remains: boolean;
      application_role_is_owner: boolean;
      inherited_role_remains: boolean;
      sequence_privilege_remains: boolean;
      application_role_bypasses_rls: boolean;
      application_role_is_superuser: boolean;
    }>
  >(`
    WITH protected_tables(table_name) AS (
      VALUES
        ('platform_sessions'),
        ('platform_capability_grants'),
        ('platform_audit_events'),
        ('two_factor_login_challenges')
    )
    SELECT
      EXISTS (
        SELECT 1 FROM protected_tables
        WHERE has_table_privilege('${applicationRole}', 'public.' || quote_ident(table_name), 'SELECT')
           OR has_table_privilege('${applicationRole}', 'public.' || quote_ident(table_name), 'INSERT')
           OR has_table_privilege('${applicationRole}', 'public.' || quote_ident(table_name), 'UPDATE')
           OR has_table_privilege('${applicationRole}', 'public.' || quote_ident(table_name), 'DELETE')
           OR has_table_privilege('${applicationRole}', 'public.' || quote_ident(table_name), 'TRUNCATE')
           OR has_table_privilege('${applicationRole}', 'public.' || quote_ident(table_name), 'REFERENCES')
           OR has_table_privilege('${applicationRole}', 'public.' || quote_ident(table_name), 'TRIGGER')
      ) AS table_privilege_remains,
      EXISTS (
        SELECT 1 FROM protected_tables
        WHERE has_any_column_privilege(
          '${applicationRole}', 'public.' || quote_ident(table_name), 'SELECT,INSERT,UPDATE,REFERENCES'
        )
      ) AS column_privilege_remains,
      EXISTS (
        SELECT 1 FROM pg_class protected_table
        JOIN pg_roles application_role ON application_role.oid = protected_table.relowner
        WHERE application_role.rolname = '${applicationRole}'
          AND protected_table.relnamespace = 'public'::regnamespace
          AND protected_table.relname IN ('platform_sessions', 'platform_capability_grants', 'platform_audit_events')
      ) AS application_role_is_owner,
      EXISTS (
        SELECT 1 FROM pg_roles inherited_role
        WHERE inherited_role.rolname <> '${applicationRole}'
          AND pg_has_role('${applicationRole}', inherited_role.oid, 'MEMBER')
      ) AS inherited_role_remains,
      has_sequence_privilege(
        '${applicationRole}', 'public.platform_audit_events_sequence_seq', 'USAGE'
      ) OR has_sequence_privilege(
        '${applicationRole}', 'public.platform_audit_events_sequence_seq', 'SELECT'
      ) OR has_sequence_privilege(
        '${applicationRole}', 'public.platform_audit_events_sequence_seq', 'UPDATE'
      ) AS sequence_privilege_remains
      , COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = '${applicationRole}'), true)
        AS application_role_bypasses_rls
      , COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = '${applicationRole}'), true)
        AS application_role_is_superuser
  `);

  if (
    !access ||
    access.table_privilege_remains ||
    access.column_privilege_remains ||
    access.application_role_is_owner ||
    access.inherited_role_remains ||
    access.sequence_privilege_remains ||
    access.application_role_bypasses_rls ||
    access.application_role_is_superuser
  ) {
    throw new PlatformControlPrivilegeError('PLATFORM_CONTROL_RUNTIME_PRIVILEGE_NOT_DENIED');
  }
}
