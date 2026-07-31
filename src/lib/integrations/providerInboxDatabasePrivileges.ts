import type { PrismaClient } from '@prisma/client';

export class ProviderInboxPrivilegeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ProviderInboxPrivilegeError';
  }
}

/** Revoke and then prove that an ordinary runtime role has no inbox access. */
export async function revokeAndVerifyProviderInboxAccess(
  client: PrismaClient,
  applicationRole: string
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(applicationRole)) {
    throw new ProviderInboxPrivilegeError('PROVIDER_INBOX_APPLICATION_ROLE_INVALID');
  }
  await client.$executeRawUnsafe(
    `REVOKE ALL PRIVILEGES ON public.provider_event_inbox FROM ${applicationRole}`
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
    SELECT has_table_privilege('${applicationRole}', 'public.provider_event_inbox', 'SELECT') AS can_select,
           has_table_privilege('${applicationRole}', 'public.provider_event_inbox', 'INSERT') AS can_insert,
           has_table_privilege('${applicationRole}', 'public.provider_event_inbox', 'UPDATE') AS can_update,
           has_table_privilege('${applicationRole}', 'public.provider_event_inbox', 'DELETE') AS can_delete,
           has_table_privilege('${applicationRole}', 'public.provider_event_inbox', 'TRUNCATE') AS can_truncate,
           has_table_privilege('${applicationRole}', 'public.provider_event_inbox', 'REFERENCES') AS can_references,
           has_table_privilege('${applicationRole}', 'public.provider_event_inbox', 'TRIGGER') AS can_trigger,
           has_any_column_privilege(
             '${applicationRole}',
             'public.provider_event_inbox',
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
    WHERE c.oid = 'public.provider_event_inbox'::regclass
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
    throw new ProviderInboxPrivilegeError('PROVIDER_INBOX_APPLICATION_ROLE_ACCESS_REMAINS');
  }
}
