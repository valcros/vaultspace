import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { providerIngressDb } from '@/lib/db';
import { recordProviderEventConflict } from '@/lib/integrations/providerEventInbox';

class ProviderInboxPreflightRollback extends Error {}

export class ProviderInboxPreflightError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ProviderInboxPreflightError';
  }
}

function prismaSqlState(error: unknown): unknown {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010'
    ? error.meta?.['code']
    : undefined;
}

export async function preflightProviderEventInbox(): Promise<void> {
  if (!process.env['EVENT_GRID_INGRESS_DATABASE_URL']) {
    throw new ProviderInboxPreflightError(
      'PROVIDER_INBOX_PREFLIGHT_DATABASE_URL_MISSING',
      'EVENT_GRID_INGRESS_DATABASE_URL is required for provider inbox preflight'
    );
  }
  const expectedInboxOwner = process.env['EVENT_GRID_INBOX_EXPECTED_OWNER']?.trim().toLowerCase();
  if (
    !expectedInboxOwner ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedInboxOwner) ||
    expectedInboxOwner === 'vaultspace_app'
  ) {
    throw new ProviderInboxPreflightError(
      'PROVIDER_INBOX_PREFLIGHT_EXPECTED_OWNER_INVALID',
      'EVENT_GRID_INBOX_EXPECTED_OWNER must identify a dedicated migration owner'
    );
  }
  let completed = false;
  try {
    await providerIngressDb.$transaction(async (tx) => {
      const [role] = await tx.$queryRaw<
        Array<{
          current_user: string;
          bypasses_rls: boolean;
          is_superuser: boolean;
          can_create_role: boolean;
          can_create_database: boolean;
          can_replicate: boolean;
          inherited_roles: string[];
          has_schema_usage: boolean;
          has_schema_create: boolean;
          has_database_create: boolean;
        }>
      >`
        SELECT current_user,
               rolbypassrls AS bypasses_rls,
               rolsuper AS is_superuser,
               rolcreaterole AS can_create_role,
               rolcreatedb AS can_create_database,
               rolreplication AS can_replicate,
               ARRAY(
                 SELECT inherited.rolname
                 FROM pg_roles inherited
                 WHERE inherited.rolname <> current_user
                   AND pg_has_role(current_user, inherited.oid, 'MEMBER')
                 ORDER BY inherited.rolname
               ) AS inherited_roles,
               has_schema_privilege(current_user, 'public', 'USAGE') AS has_schema_usage,
               has_schema_privilege(current_user, 'public', 'CREATE') AS has_schema_create,
               has_database_privilege(current_user, current_database(), 'CREATE') AS has_database_create
        FROM pg_roles
        WHERE rolname = current_user`;
      if (
        !role ||
        role.bypasses_rls ||
        role.is_superuser ||
        role.can_create_role ||
        role.can_create_database ||
        role.can_replicate ||
        role.inherited_roles.length > 0 ||
        !role.has_schema_usage ||
        role.has_schema_create ||
        role.has_database_create
      ) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_ROLE_POSTURE_INVALID',
          'Provider inbox preflight requires an isolated non-superuser role with schema USAGE only'
        );
      }
      const grants = await tx.$queryRaw<
        Array<{
          table_name: string;
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
          can_truncate: boolean;
          can_references: boolean;
          can_trigger: boolean;
          has_column_privilege: boolean;
        }>
      >`
        SELECT c.relname AS table_name,
               has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
               has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
               has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
               has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
               has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
               has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_references,
               has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_trigger,
               has_any_column_privilege(
                 current_user,
                 c.oid,
                 'SELECT,INSERT,UPDATE,REFERENCES'
               ) AS has_column_privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname`;
      const inbox = grants.find((grant) => grant.table_name === 'provider_event_inbox');
      const hasAnyPrivilege = (grant: (typeof grants)[number]) =>
        grant.can_select ||
        grant.can_insert ||
        grant.can_update ||
        grant.can_delete ||
        grant.can_truncate ||
        grant.can_references ||
        grant.can_trigger ||
        grant.has_column_privilege;
      if (
        !inbox ||
        !inbox.can_select ||
        !inbox.can_insert ||
        !inbox.can_update ||
        inbox.can_delete ||
        inbox.can_truncate ||
        inbox.can_references ||
        inbox.can_trigger ||
        grants.some(
          (grant) => grant.table_name !== 'provider_event_inbox' && hasAnyPrivilege(grant)
        )
      ) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_TABLE_GRANTS_INVALID',
          'Provider inbox database role does not have least-privilege grants'
        );
      }

      const sequenceAccess = await tx.$queryRaw<Array<{ has_privilege: boolean }>>`
        SELECT has_sequence_privilege(current_user, c.oid, 'USAGE,SELECT,UPDATE') AS has_privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'`;
      if (sequenceAccess.some((sequence) => sequence.has_privilege)) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_SEQUENCE_GRANTS_INVALID',
          'Provider inbox database role must not have sequence privileges'
        );
      }

      const [protectedFunctionAccess] = await tx.$queryRaw<
        Array<{ executable_function_count: number }>
      >`
        SELECT count(*)::int AS executable_function_count
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
          AND has_function_privilege(current_user, function.oid, 'EXECUTE')`;
      if (!protectedFunctionAccess || protectedFunctionAccess.executable_function_count > 0) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_PROTECTED_FUNCTION_GRANTS_INVALID',
          'Provider inbox database role can execute protected correlation functions'
        );
      }

      const [ownership] = await tx.$queryRaw<Array<{ table_owner: string }>>`
        SELECT owner.rolname AS table_owner
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles owner ON owner.oid = c.relowner
        WHERE n.nspname = 'public' AND c.relname = 'provider_event_inbox'`;
      if (
        !ownership ||
        ownership.table_owner !== expectedInboxOwner ||
        ownership.table_owner === role.current_user ||
        ownership.table_owner === 'vaultspace_app'
      ) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_OWNER_INVALID',
          'Provider inbox table is not owned by the allowlisted migration identity'
        );
      }

      const inboxAcl = await tx.$queryRaw<
        Array<{
          grantee: string;
          privilege_type: string;
          is_owner: boolean;
          is_grantable: boolean;
        }>
      >`
        SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
               acl.privilege_type,
               acl.grantee = c.relowner AS is_owner,
               acl.is_grantable
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(
          COALESCE(c.relacl, acldefault('r', c.relowner))
        ) acl
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE n.nspname = 'public' AND c.relname = 'provider_event_inbox'`;
      const allowedIngressPrivileges = new Set(['SELECT', 'INSERT', 'UPDATE']);
      if (
        inboxAcl.some(
          (entry) =>
            !entry.is_owner &&
            (entry.grantee !== role.current_user ||
              !allowedIngressPrivileges.has(entry.privilege_type) ||
              entry.is_grantable)
        )
      ) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_UNAUTHORIZED_ACL_GRANTEE',
          'Provider inbox table has privileges granted outside its owner and isolated ingress role'
        );
      }

      const columnAcl = await tx.$queryRaw<
        Array<{ column_name: string; grantee: string; privilege_type: string; is_owner: boolean }>
      >`
        SELECT attribute.attname AS column_name,
               COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
               acl.privilege_type,
               acl.grantee = relation.relowner AS is_owner
        FROM pg_attribute attribute
        JOIN pg_class relation ON relation.oid = attribute.attrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'provider_event_inbox'
          AND attribute.attacl IS NOT NULL
          AND NOT attribute.attisdropped`;
      if (columnAcl.some((entry) => !entry.is_owner)) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_UNAUTHORIZED_COLUMN_ACL',
          'Provider inbox columns have privileges granted outside the allowlisted owner'
        );
      }

      const expectPermissionDenied = async (
        savepoint: string,
        statement: string,
        errorCode: string,
        failureMessage: string
      ) => {
        await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
        try {
          await tx.$executeRawUnsafe(statement);
        } catch (error) {
          if (prismaSqlState(error) !== '42501') {
            throw error;
          }
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          return;
        }
        throw new ProviderInboxPreflightError(errorCode, failureMessage);
      };
      await expectPermissionDenied(
        'provider_event_tenant_read_denied',
        'SELECT 1 FROM "users" LIMIT 1',
        'PROVIDER_INBOX_PREFLIGHT_TENANT_READ_ALLOWED',
        'Provider inbox database role can read tenant tables'
      );
      await expectPermissionDenied(
        'provider_event_delete_denied',
        'DELETE FROM "provider_event_inbox" WHERE FALSE',
        'PROVIDER_INBOX_PREFLIGHT_DELETE_ALLOWED',
        'Provider inbox database role can delete receipts'
      );
      await expectPermissionDenied(
        'provider_event_public_create_denied',
        'CREATE TABLE public.provider_event_preflight_forbidden (id integer)',
        'PROVIDER_INBOX_PREFLIGHT_PUBLIC_CREATE_ALLOWED',
        'Provider inbox database role can create public objects'
      );
      await expectPermissionDenied(
        'provider_event_database_create_denied',
        'CREATE SCHEMA provider_event_preflight_forbidden',
        'PROVIDER_INBOX_PREFLIGHT_DATABASE_CREATE_ALLOWED',
        'Provider inbox database role can create schemas'
      );

      const id = `preflight-${randomUUID()}`;
      await tx.providerEventInbox.create({
        data: {
          id,
          provider: 'acs',
          eventType: 'PREFLIGHT',
          eventIdFingerprint: '1'.repeat(64),
          payloadFingerprint: '2'.repeat(64),
          payloadFingerprintKeyId: 'preflight',
          topicFingerprint: '3'.repeat(64),
          providerMessageId: 'preflight',
          providerStatus: 'Delivered',
          dataVersion: '1.0',
          metadataVersion: '1',
          eventAt: new Date(),
        },
      });

      await tx.$executeRawUnsafe('SAVEPOINT provider_event_evidence_immutable_check');
      let immutabilityRejected = false;
      try {
        await tx.$executeRawUnsafe(
          `UPDATE "provider_event_inbox" SET "eventType" = 'MUTATED' WHERE "id" = '${id}'`
        );
      } catch (error) {
        if (prismaSqlState(error) !== 'P0001') {
          throw error;
        }
        immutabilityRejected = true;
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT provider_event_evidence_immutable_check');
      }
      if (!immutabilityRejected) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_EVIDENCE_TRIGGER_INVALID',
          'Provider inbox evidence immutability trigger did not reject mutation'
        );
      }

      const leaseId = randomUUID();
      const processing = await tx.providerEventInbox.update({
        where: { id },
        data: {
          processingStatus: 'PROCESSING',
          processingAttempts: { increment: 1 },
          processingLeaseId: leaseId,
          processingLeaseExpiresAt: new Date(Date.now() + 60_000),
        },
        select: { processingStatus: true, processingLeaseId: true },
      });
      if (
        processing.processingStatus !== 'PROCESSING' ||
        processing.processingLeaseId !== leaseId
      ) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_PROCESSING_LEASE_INVALID',
          'Provider inbox processing lease update was not visible'
        );
      }
      const processed = await tx.providerEventInbox.update({
        where: { id },
        data: {
          processingStatus: 'PROCESSED',
          processingLeaseId: null,
          processingLeaseExpiresAt: null,
          processedAt: new Date(),
        },
        select: { processingStatus: true, processedAt: true },
      });
      if (processed.processingStatus !== 'PROCESSED' || !processed.processedAt) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_PROCESSED_TRANSITION_INVALID',
          'Provider inbox processed transition was not visible'
        );
      }

      await recordProviderEventConflict(tx, id, '4'.repeat(64));
      await tx.$executeRawUnsafe('SAVEPOINT provider_event_conflict_terminal_check');
      let terminalConflictRejected = false;
      try {
        await tx.$executeRawUnsafe(
          `UPDATE "provider_event_inbox" SET "processingStatus" = 'PENDING' WHERE "id" = '${id}'`
        );
      } catch (error) {
        if (prismaSqlState(error) !== 'P0001') {
          throw error;
        }
        terminalConflictRejected = true;
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT provider_event_conflict_terminal_check');
      }
      if (!terminalConflictRejected) {
        throw new ProviderInboxPreflightError(
          'PROVIDER_INBOX_PREFLIGHT_CONFLICT_TRIGGER_INVALID',
          'Provider inbox terminal conflict trigger did not reject transition'
        );
      }
      completed = true;
      throw new ProviderInboxPreflightRollback('Rollback provider inbox preflight canary');
    });
  } catch (error) {
    if (!(error instanceof ProviderInboxPreflightRollback)) {
      throw error;
    }
  }
  if (!completed) {
    throw new ProviderInboxPreflightError(
      'PROVIDER_INBOX_PREFLIGHT_INCOMPLETE',
      'Provider inbox preflight did not complete'
    );
  }
}

async function main(): Promise<void> {
  await preflightProviderEventInbox();
  console.log(
    JSON.stringify({
      component: 'provider-event-inbox',
      event: 'preflight_completed',
      outcome: 'success',
    })
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error) => {
      console.error(
        JSON.stringify({
          component: 'provider-event-inbox',
          event: 'preflight_failed',
          outcome: 'failed',
          errorCode:
            error instanceof ProviderInboxPreflightError
              ? error.code
              : 'PROVIDER_INBOX_PREFLIGHT_DATABASE_UNAVAILABLE',
        })
      );
      process.exitCode = 1;
    })
    .finally(() => providerIngressDb.$disconnect());
}
