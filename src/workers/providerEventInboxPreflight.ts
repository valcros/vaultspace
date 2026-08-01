import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { providerIngressDb } from '@/lib/db';
import { getDeploymentMode } from '@/lib/deployment-mode';
import { recordProviderEventConflict } from '@/lib/integrations/providerEventInbox';

class ProviderInboxPreflightRollback extends Error {}

export const PROVIDER_EVENT_INBOX_OWNERSHIP_CONTRACT_VERSION = '2026-07-31.2';
const EXPECTED_GUARD_FUNCTION_SOURCE_SHA256 =
  'e63693ca987c4945d08c0aefbcbe6e525b8230345b480aeaa24718af8122283e';

const EXPECTED_GUARD_TRIGGER_DEFINITION =
  'CREATE TRIGGER provider_event_evidence_immutable BEFORE INSERT OR UPDATE ON public.provider_event_inbox FOR EACH ROW EXECUTE FUNCTION prevent_provider_event_evidence_change()';
const DATABASE_GUARD_RULES = new Set([
  'PROVIDER_EVENT_INGRESS_INITIAL_STATE_INVALID',
  'PROVIDER_EVENT_CONFLICT_INTENT_INVALID',
  'PROVIDER_EVENT_FIRST_SEEN_EVIDENCE_IMMUTABLE',
  'PROVIDER_EVENT_CONFLICT_TERMINAL',
]);
const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

function prismaGuardRule(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2010') {
    return undefined;
  }
  const metadataMessage = error.meta?.['message'];
  if (typeof metadataMessage !== 'string') {
    return undefined;
  }
  const primaryRule = metadataMessage.match(/(?:^|\n)ERROR:\s*([A-Z][A-Z0-9_]*)(?:\n|$)/)?.[1];
  return primaryRule && DATABASE_GUARD_RULES.has(primaryRule) ? primaryRule : undefined;
}

function sourceDigest(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

function randomFingerprint(): string {
  return randomUUID().replaceAll('-', '').padEnd(64, '0');
}

function safeRelease(): string {
  const release = process.env['APP_RELEASE']?.trim();
  return release && SAFE_RELEASE.test(release) ? release : 'unknown';
}

export function providerInboxPreflightDiagnostic(
  event: 'preflight_completed' | 'preflight_failed',
  outcome: 'success' | 'failed',
  effectiveRoleCategory: 'isolated_ingress' | 'unverified',
  errorCode?: string
): Record<string, string> {
  return {
    component: 'provider-event-inbox',
    event,
    outcome,
    contractVersion: PROVIDER_EVENT_INBOX_OWNERSHIP_CONTRACT_VERSION,
    release: safeRelease(),
    deploymentMode: getDeploymentMode(),
    observedAt: new Date().toISOString(),
    effectiveRoleCategory,
    ...(errorCode ? { errorCode } : {}),
  };
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
  let canariesCompleted = false;
  let rollbackRecognized = false;
  try {
    await providerIngressDb.$transaction(
      async (tx) => {
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
            'password_reset_provider_correlation_preflight_counts',
            'prevent_provider_event_evidence_change'
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

        const [guardPosture] = await tx.$queryRaw<
          Array<{
            protected_function_count: number;
            exact_function_posture_count: number;
            exact_trigger_count: number;
            noninternal_inbox_trigger_count: number;
            foreign_function_attachment_count: number;
            function_source: string | null;
          }>
        >`
        SELECT
          (
            SELECT count(*)::int
            FROM pg_proc function
            JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
            WHERE namespace.nspname = 'public'
              AND function.proname = 'prevent_provider_event_evidence_change'
          ) AS protected_function_count,
          (
            SELECT count(*)::int
            FROM pg_proc function
            JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
            JOIN pg_language language ON language.oid = function.prolang
            JOIN pg_class relation
              ON relation.oid = 'public.provider_event_inbox'::regclass
            WHERE namespace.nspname = 'public'
              AND function.proname = 'prevent_provider_event_evidence_change'
              AND function.pronargs = 0
              AND function.proowner = relation.relowner
              AND function.proowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
              AND NOT EXISTS (
                SELECT 1
                FROM pg_roles role
                WHERE role.rolname = 'vaultspace_app' AND role.oid = function.proowner
              )
              AND function.prosecdef = false
              AND function.provolatile = 'v'
              AND function.proretset = false
              AND function.prorettype = 'pg_catalog.trigger'::regtype
              AND language.lanname = 'plpgsql'
              AND function.proconfig = ARRAY['search_path=pg_catalog']::text[]
              AND NOT EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(function.proacl, acldefault('f', function.proowner))) acl
                WHERE acl.grantee <> function.proowner
              )
          ) AS exact_function_posture_count,
          (
            SELECT count(*)::int
            FROM pg_trigger trigger
            JOIN pg_proc function ON function.oid = trigger.tgfoid
            WHERE trigger.tgrelid = 'public.provider_event_inbox'::regclass
              AND trigger.tgname = 'provider_event_evidence_immutable'
              AND trigger.tgenabled = 'O'
              AND trigger.tgtype = 23
              AND NOT trigger.tgisinternal
              AND function.pronamespace = 'public'::regnamespace
              AND function.proname = 'prevent_provider_event_evidence_change'
              AND function.pronargs = 0
              AND pg_get_triggerdef(trigger.oid) = ${EXPECTED_GUARD_TRIGGER_DEFINITION}
          ) AS exact_trigger_count,
          (
            SELECT count(*)::int
            FROM pg_trigger trigger
            WHERE trigger.tgrelid = 'public.provider_event_inbox'::regclass
              AND NOT trigger.tgisinternal
          ) AS noninternal_inbox_trigger_count,
          (
            SELECT count(*)::int
            FROM pg_trigger trigger
            JOIN pg_proc function ON function.oid = trigger.tgfoid
            JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
            WHERE namespace.nspname = 'public'
              AND function.proname = 'prevent_provider_event_evidence_change'
              AND function.pronargs = 0
              AND NOT trigger.tgisinternal
              AND trigger.tgrelid <> 'public.provider_event_inbox'::regclass
          ) AS foreign_function_attachment_count,
          (
            SELECT function.prosrc
            FROM pg_proc function
            JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
            WHERE namespace.nspname = 'public'
              AND function.proname = 'prevent_provider_event_evidence_change'
              AND function.pronargs = 0
          ) AS function_source`;
        if (
          !guardPosture ||
          guardPosture.protected_function_count !== 1 ||
          guardPosture.exact_function_posture_count !== 1 ||
          guardPosture.exact_trigger_count !== 1 ||
          guardPosture.noninternal_inbox_trigger_count !== 1 ||
          guardPosture.foreign_function_attachment_count !== 0 ||
          !guardPosture.function_source ||
          sourceDigest(guardPosture.function_source) !== EXPECTED_GUARD_FUNCTION_SOURCE_SHA256
        ) {
          throw new ProviderInboxPreflightError(
            'PROVIDER_INBOX_PREFLIGHT_GUARD_POSTURE_INVALID',
            'Provider inbox guard function or trigger posture is invalid'
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
              throw new ProviderInboxPreflightError(errorCode, failureMessage);
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

        const expectGuardRejection = async (
          savepoint: string,
          statement: string,
          expectedRule: string,
          errorCode: string,
          failureMessage: string
        ) => {
          await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
          try {
            await tx.$executeRawUnsafe(statement);
          } catch (error) {
            if (prismaSqlState(error) === 'P0001' && prismaGuardRule(error) === expectedRule) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              return;
            }
            throw new ProviderInboxPreflightError(errorCode, failureMessage);
          }
          throw new ProviderInboxPreflightError(errorCode, failureMessage);
        };
        await expectPermissionDenied(
          'provider_event_guard_direct_execute_denied',
          'SELECT public.prevent_provider_event_evidence_change()',
          'PROVIDER_INBOX_PREFLIGHT_GUARD_EXECUTE_ALLOWED',
          'Provider inbox database role can execute the protected trigger function'
        );

        const id = `preflight-${randomUUID()}`;
        const quarantineId = `preflight-quarantine-${randomUUID()}`;
        const initialSelect = {
          id: true,
          provider: true,
          eventType: true,
          eventIdFingerprint: true,
          payloadFingerprint: true,
          payloadFingerprintKeyId: true,
          topicFingerprint: true,
          providerMessageId: true,
          providerStatus: true,
          dataVersion: true,
          metadataVersion: true,
          eventAt: true,
          deliveryAttemptAt: true,
          createdAt: true,
          receivedAt: true,
          updatedAt: true,
          nextProcessingAt: true,
          processingStatus: true,
          processingAttempts: true,
          processingLeaseId: true,
          processingLeaseExpiresAt: true,
          processedAt: true,
          lastErrorCode: true,
          quarantineReasonCodes: true,
          conflictCount: true,
          firstConflictAt: true,
          conflictingPayloadFingerprint: true,
          lastConflictAt: true,
          lastConflictingPayloadFingerprint: true,
        } as const;
        const pendingEventFingerprint = randomFingerprint();
        const pendingEventAt = new Date();
        const pending = await tx.providerEventInbox.create({
          data: {
            id,
            provider: 'acs',
            eventType: 'PREFLIGHT',
            eventIdFingerprint: pendingEventFingerprint,
            payloadFingerprint: '2'.repeat(64),
            payloadFingerprintKeyId: 'preflight',
            topicFingerprint: '3'.repeat(64),
            providerMessageId: 'preflight',
            providerStatus: 'Delivered',
            dataVersion: '1.0',
            metadataVersion: '1',
            eventAt: pendingEventAt,
          },
          select: initialSelect,
        });
        const pendingTime = pending.createdAt.getTime();
        if (
          pending.id !== id ||
          pending.provider !== 'acs' ||
          pending.eventType !== 'PREFLIGHT' ||
          pending.eventIdFingerprint !== pendingEventFingerprint ||
          pending.payloadFingerprint !== '2'.repeat(64) ||
          pending.payloadFingerprintKeyId !== 'preflight' ||
          pending.topicFingerprint !== '3'.repeat(64) ||
          pending.providerMessageId !== 'preflight' ||
          pending.providerStatus !== 'Delivered' ||
          pending.dataVersion !== '1.0' ||
          pending.metadataVersion !== '1' ||
          pending.eventAt.getTime() !== pendingEventAt.getTime() ||
          pending.deliveryAttemptAt !== null ||
          pending.receivedAt.getTime() !== pendingTime ||
          pending.updatedAt.getTime() !== pendingTime ||
          pending.nextProcessingAt.getTime() !== pendingTime ||
          pending.processingStatus !== 'PENDING' ||
          pending.processingAttempts !== 0 ||
          pending.processingLeaseId !== null ||
          pending.processingLeaseExpiresAt !== null ||
          pending.processedAt !== null ||
          pending.lastErrorCode !== null ||
          pending.quarantineReasonCodes.length !== 0 ||
          pending.conflictCount !== 0 ||
          pending.firstConflictAt !== null ||
          pending.conflictingPayloadFingerprint !== null ||
          pending.lastConflictAt !== null ||
          pending.lastConflictingPayloadFingerprint !== null
        ) {
          throw new ProviderInboxPreflightError(
            'PROVIDER_INBOX_PREFLIGHT_PENDING_INSERT_INVALID',
            'Provider inbox pending receipt was not normalized by the guard'
          );
        }
        const quarantineEventFingerprint = randomFingerprint();
        const quarantineEventAt = new Date();
        const quarantined = await tx.providerEventInbox.create({
          data: {
            id: quarantineId,
            provider: 'acs',
            eventType: 'PREFLIGHT',
            eventIdFingerprint: quarantineEventFingerprint,
            payloadFingerprint: '6'.repeat(64),
            payloadFingerprintKeyId: 'preflight',
            topicFingerprint: '7'.repeat(64),
            providerMessageId: 'preflight-quarantine',
            providerStatus: null,
            dataVersion: '1.0',
            metadataVersion: '1',
            eventAt: quarantineEventAt,
            processingStatus: 'QUARANTINED',
            lastErrorCode: 'PROVIDER_STATUS_MISSING',
            quarantineReasonCodes: ['PROVIDER_STATUS_MISSING'],
          },
          select: initialSelect,
        });
        const quarantineTime = quarantined.createdAt.getTime();
        if (
          quarantined.id !== quarantineId ||
          quarantined.provider !== 'acs' ||
          quarantined.eventType !== 'PREFLIGHT' ||
          quarantined.eventIdFingerprint !== quarantineEventFingerprint ||
          quarantined.payloadFingerprint !== '6'.repeat(64) ||
          quarantined.payloadFingerprintKeyId !== 'preflight' ||
          quarantined.topicFingerprint !== '7'.repeat(64) ||
          quarantined.providerMessageId !== 'preflight-quarantine' ||
          quarantined.providerStatus !== null ||
          quarantined.dataVersion !== '1.0' ||
          quarantined.metadataVersion !== '1' ||
          quarantined.eventAt.getTime() !== quarantineEventAt.getTime() ||
          quarantined.deliveryAttemptAt !== null ||
          quarantined.receivedAt.getTime() !== quarantineTime ||
          quarantined.updatedAt.getTime() !== quarantineTime ||
          quarantined.nextProcessingAt.getTime() !== quarantineTime ||
          quarantined.processingStatus !== 'QUARANTINED' ||
          quarantined.processingAttempts !== 0 ||
          quarantined.processingLeaseId !== null ||
          quarantined.processingLeaseExpiresAt !== null ||
          quarantined.processedAt !== null ||
          quarantined.lastErrorCode !== 'PROVIDER_STATUS_MISSING' ||
          quarantined.quarantineReasonCodes.join(',') !== 'PROVIDER_STATUS_MISSING' ||
          quarantined.conflictCount !== 0 ||
          quarantined.firstConflictAt !== null ||
          quarantined.conflictingPayloadFingerprint !== null ||
          quarantined.lastConflictAt !== null ||
          quarantined.lastConflictingPayloadFingerprint !== null
        ) {
          throw new ProviderInboxPreflightError(
            'PROVIDER_INBOX_PREFLIGHT_QUARANTINE_INSERT_INVALID',
            'Provider inbox quarantined receipt was not normalized by the guard'
          );
        }
        const leaseId = randomUUID();
        const forbiddenProcessingId = `preflight-processing-${randomUUID()}`;
        await expectGuardRejection(
          'provider_event_processing_insert_denied',
          `INSERT INTO "provider_event_inbox" (
          "id", "provider", "eventType", "eventIdFingerprint", "payloadFingerprint",
          "payloadFingerprintKeyId", "topicFingerprint", "providerMessageId", "providerStatus",
          "dataVersion", "metadataVersion", "eventAt", "processingStatus", "processingAttempts",
          "processingLeaseId", "processingLeaseExpiresAt"
        ) VALUES (
          '${forbiddenProcessingId}', 'acs', 'PREFLIGHT', repeat('8', 64), repeat('9', 64),
          'preflight', repeat('a', 64), 'preflight-processing', 'Delivered', '1.0', '1',
          clock_timestamp(), 'PROCESSING', 1, '${leaseId}', clock_timestamp() + interval '1 minute'
        )`,
          'PROVIDER_EVENT_INGRESS_INITIAL_STATE_INVALID',
          'PROVIDER_INBOX_PREFLIGHT_PROCESSING_INSERT_ALLOWED',
          'Provider inbox database role can insert projector-owned processing state'
        );
        await expectGuardRejection(
          'provider_event_evidence_immutable_check',
          `UPDATE "provider_event_inbox" SET "eventType" = 'MUTATED' WHERE "id" = '${id}'`,
          'PROVIDER_EVENT_FIRST_SEEN_EVIDENCE_IMMUTABLE',
          'PROVIDER_INBOX_PREFLIGHT_EVIDENCE_TRIGGER_INVALID',
          'Provider inbox evidence immutability trigger did not reject mutation'
        );
        await expectGuardRejection(
          'provider_event_processing_transition_denied',
          `UPDATE "provider_event_inbox"
         SET "processingStatus" = 'PROCESSING', "processingAttempts" = "processingAttempts" + 1,
             "processingLeaseId" = '${leaseId}',
             "processingLeaseExpiresAt" = clock_timestamp() + interval '1 minute'
         WHERE "id" = '${id}'`,
          'PROVIDER_EVENT_CONFLICT_INTENT_INVALID',
          'PROVIDER_INBOX_PREFLIGHT_PROCESSING_TRANSITION_ALLOWED',
          'Provider inbox database role can transition a receipt to processing'
        );
        await expectGuardRejection(
          'provider_event_processed_transition_denied',
          `UPDATE "provider_event_inbox"
         SET "processingStatus" = 'PROCESSED', "processedAt" = clock_timestamp()
         WHERE "id" = '${id}'`,
          'PROVIDER_EVENT_CONFLICT_INTENT_INVALID',
          'PROVIDER_INBOX_PREFLIGHT_PROCESSED_TRANSITION_ALLOWED',
          'Provider inbox database role can transition a receipt to processed'
        );
        await expectGuardRejection(
          'provider_event_attempt_increment_denied',
          `UPDATE "provider_event_inbox"
         SET "processingAttempts" = "processingAttempts" + 1 WHERE "id" = '${id}'`,
          'PROVIDER_EVENT_CONFLICT_INTENT_INVALID',
          'PROVIDER_INBOX_PREFLIGHT_PROCESSING_ATTEMPT_MUTATION_ALLOWED',
          'Provider inbox database role can change processing attempts'
        );
        await expectGuardRejection(
          'provider_event_schedule_mutation_denied',
          `UPDATE "provider_event_inbox"
         SET "nextProcessingAt" = "nextProcessingAt" + interval '1 minute' WHERE "id" = '${id}'`,
          'PROVIDER_EVENT_CONFLICT_INTENT_INVALID',
          'PROVIDER_INBOX_PREFLIGHT_PROCESSING_SCHEDULE_MUTATION_ALLOWED',
          'Provider inbox database role can change the processing schedule'
        );
        await expectGuardRejection(
          'provider_event_error_mutation_denied',
          `UPDATE "provider_event_inbox"
         SET "lastErrorCode" = 'INGRESS_MUTATION' WHERE "id" = '${id}'`,
          'PROVIDER_EVENT_CONFLICT_INTENT_INVALID',
          'PROVIDER_INBOX_PREFLIGHT_PROCESSING_ERROR_MUTATION_ALLOWED',
          'Provider inbox database role can change processing diagnostics'
        );
        await expectGuardRejection(
          'provider_event_conflict_processor_mutation_denied',
          `UPDATE "provider_event_inbox"
         SET "processingStatus" = 'CONFLICT', "conflictCount" = "conflictCount" + 1,
             "firstConflictAt" = clock_timestamp(),
             "conflictingPayloadFingerprint" = repeat('4', 64),
             "lastConflictAt" = clock_timestamp(),
             "lastConflictingPayloadFingerprint" = repeat('4', 64),
             "lastErrorCode" = 'EVENT_ID_PAYLOAD_CONFLICT',
             "processingAttempts" = "processingAttempts" + 1,
             "nextProcessingAt" = "nextProcessingAt" + interval '1 minute',
             "processedAt" = clock_timestamp(),
             "processingLeaseId" = NULL, "processingLeaseExpiresAt" = NULL
         WHERE "id" = '${id}'`,
          'PROVIDER_EVENT_CONFLICT_INTENT_INVALID',
          'PROVIDER_INBOX_PREFLIGHT_CONFLICT_PROCESSING_MUTATION_ALLOWED',
          'Provider inbox conflict transition can change projector-owned state'
        );

        const conflictingFingerprint = '4'.repeat(64);
        const conflictCount = await recordProviderEventConflict(tx, id, conflictingFingerprint);
        const conflicted = await tx.providerEventInbox.findUniqueOrThrow({
          where: { id },
          select: initialSelect,
        });
        if (
          conflictCount !== 1 ||
          conflicted.processingStatus !== 'CONFLICT' ||
          conflicted.conflictCount !== 1 ||
          conflicted.lastErrorCode !== 'EVENT_ID_PAYLOAD_CONFLICT' ||
          conflicted.processingLeaseId !== null ||
          conflicted.processingLeaseExpiresAt !== null ||
          conflicted.processingAttempts !== pending.processingAttempts ||
          conflicted.nextProcessingAt.getTime() !== pending.nextProcessingAt.getTime() ||
          conflicted.processedAt !== pending.processedAt ||
          conflicted.id !== pending.id ||
          conflicted.createdAt.getTime() !== pending.createdAt.getTime() ||
          conflicted.receivedAt.getTime() !== pending.receivedAt.getTime() ||
          conflicted.provider !== pending.provider ||
          conflicted.eventType !== pending.eventType ||
          conflicted.eventIdFingerprint !== pending.eventIdFingerprint ||
          conflicted.payloadFingerprint !== pending.payloadFingerprint ||
          conflicted.payloadFingerprintKeyId !== pending.payloadFingerprintKeyId ||
          conflicted.topicFingerprint !== pending.topicFingerprint ||
          conflicted.providerMessageId !== pending.providerMessageId ||
          conflicted.providerStatus !== pending.providerStatus ||
          conflicted.dataVersion !== pending.dataVersion ||
          conflicted.metadataVersion !== pending.metadataVersion ||
          conflicted.eventAt.getTime() !== pending.eventAt.getTime() ||
          conflicted.deliveryAttemptAt !== pending.deliveryAttemptAt ||
          conflicted.quarantineReasonCodes.join(',') !== pending.quarantineReasonCodes.join(',') ||
          conflicted.firstConflictAt === null ||
          conflicted.lastConflictAt === null ||
          conflicted.firstConflictAt.getTime() !== conflicted.lastConflictAt.getTime() ||
          conflicted.firstConflictAt.getTime() < pending.receivedAt.getTime() ||
          conflicted.conflictingPayloadFingerprint !== conflictingFingerprint ||
          conflicted.lastConflictingPayloadFingerprint !== conflictingFingerprint ||
          conflicted.updatedAt.getTime() < pending.updatedAt.getTime() ||
          conflicted.updatedAt.getTime() < conflicted.lastConflictAt.getTime()
        ) {
          throw new ProviderInboxPreflightError(
            'PROVIDER_INBOX_PREFLIGHT_CONFLICT_TRANSITION_INVALID',
            'Provider inbox conflict transition did not preserve the reviewed state boundary'
          );
        }
        await expectGuardRejection(
          'provider_event_conflict_terminal_check',
          `UPDATE "provider_event_inbox" SET "processingStatus" = 'PENDING' WHERE "id" = '${id}'`,
          'PROVIDER_EVENT_CONFLICT_TERMINAL',
          'PROVIDER_INBOX_PREFLIGHT_CONFLICT_TRIGGER_INVALID',
          'Provider inbox terminal conflict trigger did not reject transition'
        );
        canariesCompleted = true;
        throw new ProviderInboxPreflightRollback('Rollback provider inbox preflight canary');
      },
      { maxWait: 5_000, timeout: 30_000 }
    );
  } catch (error) {
    if (!(error instanceof ProviderInboxPreflightRollback)) {
      throw error;
    }
    rollbackRecognized = true;
  }
  if (!canariesCompleted || !rollbackRecognized) {
    throw new ProviderInboxPreflightError(
      'PROVIDER_INBOX_PREFLIGHT_INCOMPLETE',
      'Provider inbox preflight did not complete'
    );
  }
}

async function main(): Promise<void> {
  await preflightProviderEventInbox();
  console.log(
    JSON.stringify(
      providerInboxPreflightDiagnostic('preflight_completed', 'success', 'isolated_ingress')
    )
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error) => {
      console.error(
        JSON.stringify({
          ...providerInboxPreflightDiagnostic(
            'preflight_failed',
            'failed',
            'unverified',
            error instanceof ProviderInboxPreflightError
              ? error.code
              : 'PROVIDER_INBOX_PREFLIGHT_DATABASE_UNAVAILABLE'
          ),
        })
      );
      process.exitCode = 1;
    })
    .finally(() => providerIngressDb.$disconnect());
}
