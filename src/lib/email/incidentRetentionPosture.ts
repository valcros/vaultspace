import type { PrismaClient } from '@prisma/client';

export interface RetentionRolePosture {
  role_name: string;
  function_owner: string;
  incident_owner: string;
  audit_owner: string;
  can_login: boolean;
  is_superuser: boolean;
  bypasses_rls: boolean;
  can_inherit: boolean;
  has_memberships: boolean;
  can_create_database: boolean;
  can_create_schema: boolean;
  can_use_schema: boolean;
  can_execute: boolean;
  can_grant_execute: boolean;
  public_execute: boolean;
  other_execute_grants: boolean;
  security_definer: boolean;
  public_table_access: boolean;
}

export function assertRetentionRolePosture(
  posture: RetentionRolePosture | undefined,
  expectedRole: string,
  expectedOwner: string
): void {
  if (
    !posture ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedRole) ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedOwner) ||
    expectedRole === expectedOwner ||
    posture.role_name !== expectedRole ||
    posture.function_owner !== expectedOwner ||
    posture.incident_owner !== expectedOwner ||
    posture.audit_owner !== expectedOwner ||
    !posture.can_login ||
    posture.is_superuser ||
    posture.bypasses_rls ||
    posture.can_inherit ||
    posture.has_memberships ||
    posture.can_create_database ||
    posture.can_create_schema ||
    !posture.can_use_schema ||
    !posture.can_execute ||
    posture.can_grant_execute ||
    posture.public_execute ||
    posture.other_execute_grants ||
    !posture.security_definer ||
    posture.public_table_access
  ) {
    throw new Error('EMAIL_INCIDENT_RETENTION_POSTURE_INVALID');
  }
}

/** Fails closed if the maintenance login can read or write any public table. */
export async function preflightIncidentRetention(client: PrismaClient): Promise<void> {
  const [posture] = await client.$queryRaw<RetentionRolePosture[]>`
    SELECT current_user::text AS role_name,
           pg_get_userbyid(fn.proowner)::text AS function_owner,
           pg_get_userbyid(incidents.relowner)::text AS incident_owner,
           pg_get_userbyid(audit.relowner)::text AS audit_owner,
           role.rolcanlogin AS can_login,
           role.rolsuper AS is_superuser,
           role.rolbypassrls AS bypasses_rls,
           role.rolinherit AS can_inherit,
           EXISTS (
             SELECT 1 FROM pg_roles other
             WHERE other.oid <> role.oid
               AND pg_has_role(current_user, other.oid, 'MEMBER')
           ) AS has_memberships,
           has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema,
           has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
           has_function_privilege(current_user, fn.oid, 'EXECUTE') AS can_execute,
           has_function_privilege(current_user, fn.oid, 'EXECUTE WITH GRANT OPTION') AS can_grant_execute,
           EXISTS (
             SELECT 1 FROM aclexplode(COALESCE(fn.proacl, acldefault('f', fn.proowner))) acl
             WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute,
           EXISTS (
             SELECT 1 FROM aclexplode(COALESCE(fn.proacl, acldefault('f', fn.proowner))) acl
             WHERE acl.privilege_type = 'EXECUTE'
               AND acl.grantee NOT IN (0, fn.proowner, role.oid)
           ) AS other_execute_grants,
           fn.prosecdef AS security_definer,
           EXISTS (
             SELECT 1 FROM pg_class candidate
             JOIN pg_namespace namespace ON namespace.oid = candidate.relnamespace
             WHERE namespace.nspname = 'public'
               AND candidate.relkind IN ('r', 'p', 'v', 'm', 'f')
               AND (
                 has_table_privilege(current_user, candidate.oid, 'SELECT')
                 OR has_table_privilege(current_user, candidate.oid, 'INSERT')
                 OR has_table_privilege(current_user, candidate.oid, 'UPDATE')
                 OR has_table_privilege(current_user, candidate.oid, 'DELETE')
                 OR has_table_privilege(current_user, candidate.oid, 'TRUNCATE')
                 OR has_any_column_privilege(
                   current_user, candidate.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
                 )
               )
           ) AS public_table_access
    FROM pg_proc fn
    JOIN pg_roles role ON role.rolname = current_user
    CROSS JOIN pg_class incidents
    CROSS JOIN pg_class audit
    WHERE fn.oid = 'public.purge_email_delivery_incidents_v1()'::regprocedure
      AND incidents.oid = 'public.email_delivery_incidents'::regclass
      AND audit.oid = 'public.platform_audit_events'::regclass
  `;
  assertRetentionRolePosture(
    posture,
    process.env['EMAIL_INCIDENT_RETENTION_EXPECTED_DB_ROLE'] ?? '',
    process.env['EMAIL_INCIDENT_RETENTION_EXPECTED_OWNER'] ?? ''
  );
}
