import { randomUUID } from 'node:crypto';

import { createIncidentCollectorClient } from '@/lib/email/incidentRepository';

interface IncidentCollectorPosture {
  role_name: string;
  owner_name: string;
  can_login: boolean;
  is_superuser: boolean;
  bypasses_rls: boolean;
  can_inherit: boolean;
  has_memberships: boolean;
  can_create_database: boolean;
  can_create_schema: boolean;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_truncate: boolean;
  can_reference: boolean;
  can_trigger: boolean;
  can_grant_select: boolean;
  can_grant_insert: boolean;
  can_update_column: boolean;
  public_table_access: boolean;
  other_table_access: boolean;
  guard_trigger_present: boolean;
}

export function assertIncidentCollectorPosture(
  posture: IncidentCollectorPosture | undefined,
  expectedRole: string,
  expectedOwner: string
): void {
  if (
    !posture ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedRole) ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedOwner) ||
    expectedRole === expectedOwner ||
    posture.role_name !== expectedRole ||
    posture.owner_name !== expectedOwner ||
    !posture.can_login ||
    posture.is_superuser ||
    posture.bypasses_rls ||
    posture.can_inherit ||
    posture.has_memberships ||
    posture.can_create_database ||
    posture.can_create_schema ||
    !posture.can_select ||
    !posture.can_insert ||
    posture.can_update ||
    posture.can_delete ||
    posture.can_truncate ||
    posture.can_reference ||
    posture.can_trigger ||
    posture.can_grant_select ||
    posture.can_grant_insert ||
    posture.can_update_column ||
    posture.public_table_access ||
    posture.other_table_access ||
    !posture.guard_trigger_present
  ) {
    throw new Error('EMAIL_INCIDENT_COLLECTOR_POSTURE_INVALID');
  }
}

export async function preflightEmailIncidentCollector(): Promise<void> {
  const client = createIncidentCollectorClient();
  try {
    const [posture] = await client.$queryRawUnsafe<IncidentCollectorPosture[]>(`
      SELECT current_user::text AS role_name,
             pg_get_userbyid(target.relowner)::text AS owner_name,
             role.rolcanlogin AS can_login,
             role.rolsuper AS is_superuser,
             role.rolbypassrls AS bypasses_rls,
             role.rolinherit AS can_inherit,
             EXISTS (
               SELECT 1 FROM pg_roles other
               WHERE other.oid <> role.oid AND pg_has_role(current_user, other.oid, 'MEMBER')
             ) AS has_memberships,
             has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
             has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema,
             has_table_privilege(current_user, target.oid, 'SELECT') AS can_select,
             has_table_privilege(current_user, target.oid, 'INSERT') AS can_insert,
             has_table_privilege(current_user, target.oid, 'UPDATE') AS can_update,
             has_table_privilege(current_user, target.oid, 'DELETE') AS can_delete,
             has_table_privilege(current_user, target.oid, 'TRUNCATE') AS can_truncate,
             has_table_privilege(current_user, target.oid, 'REFERENCES') AS can_reference,
             has_table_privilege(current_user, target.oid, 'TRIGGER') AS can_trigger,
             has_table_privilege(current_user, target.oid, 'SELECT WITH GRANT OPTION') AS can_grant_select,
             has_table_privilege(current_user, target.oid, 'INSERT WITH GRANT OPTION') AS can_grant_insert,
             has_any_column_privilege(current_user, target.oid, 'UPDATE,REFERENCES') AS can_update_column,
             EXISTS (
               SELECT 1 FROM aclexplode(COALESCE(target.relacl, acldefault('r', target.relowner))) acl
               WHERE acl.grantee = 0
                 AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
             ) AS public_table_access,
             EXISTS (
               SELECT 1 FROM pg_class other_table
               JOIN pg_namespace namespace ON namespace.oid = other_table.relnamespace
               WHERE namespace.nspname = 'public'
                 AND other_table.relkind IN ('r', 'p', 'v', 'm', 'f')
                 AND other_table.oid <> target.oid
                 AND (
                   has_table_privilege(current_user, other_table.oid, 'SELECT')
                   OR has_table_privilege(current_user, other_table.oid, 'INSERT')
                   OR has_table_privilege(current_user, other_table.oid, 'UPDATE')
                   OR has_table_privilege(current_user, other_table.oid, 'DELETE')
                   OR has_table_privilege(current_user, other_table.oid, 'TRUNCATE')
                   OR has_any_column_privilege(current_user, other_table.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
                 )
             ) AS other_table_access,
             EXISTS (
               SELECT 1 FROM pg_trigger trigger
               WHERE trigger.tgrelid = target.oid
                 AND trigger.tgname = 'email_delivery_incident_ack_once'
                 AND trigger.tgenabled = 'O'
                 AND NOT trigger.tgisinternal
             ) AS guard_trigger_present
      FROM pg_class target
      JOIN pg_roles role ON role.rolname = current_user
      WHERE target.oid = 'public.email_delivery_incidents'::regclass
    `);
    assertIncidentCollectorPosture(
      posture,
      process.env['EMAIL_INCIDENT_EXPECTED_DB_ROLE'] ?? '',
      process.env['EMAIL_INCIDENT_EXPECTED_OWNER'] ?? ''
    );

    const canaryId = randomUUID();
    const rollbackMarker = 'EMAIL_INCIDENT_PREFLIGHT_ROLLBACK';
    try {
      await client.$transaction(async (tx) => {
        await tx.emailDeliveryIncident.create({
          data: {
            id: canaryId,
            provider: 'acs',
            providerMessageId: canaryId,
            recipientFingerprint: '0'.repeat(64),
            recipientFingerprintKeyId: 'preflight',
            recipientDomain: 'preflight.invalid',
            status: 'Bounced',
            failureReason: 'DnsDomainDoesNotExist',
            eventAt: new Date(),
          },
        });
        const found = await tx.emailDeliveryIncident.findUnique({
          where: { id: canaryId },
          select: { id: true },
        });
        if (found?.id !== canaryId) {
          throw new Error('EMAIL_INCIDENT_PREFLIGHT_CANARY_FAILED');
        }
        throw new Error(rollbackMarker);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== rollbackMarker) {
        throw new Error('EMAIL_INCIDENT_PREFLIGHT_CANARY_FAILED');
      }
    }
  } finally {
    await client.$disconnect();
  }
}

async function main(): Promise<void> {
  try {
    await preflightEmailIncidentCollector();
    console.log(
      JSON.stringify({
        component: 'email-delivery-incident-preflight',
        event: 'run',
        outcome: 'passed',
      })
    );
  } catch {
    console.error(
      JSON.stringify({
        component: 'email-delivery-incident-preflight',
        event: 'run',
        outcome: 'failed',
        errorCode: 'EMAIL_INCIDENT_PREFLIGHT_FAILED',
      })
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
