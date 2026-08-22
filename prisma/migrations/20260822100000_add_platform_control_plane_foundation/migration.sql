-- Platform control-plane foundation. This migration is additive only: it does
-- not modify users, memberships, rooms, documents, or tenant Events.
--
-- The global audit table intentionally has no foreign keys. Platform evidence
-- must survive later user deactivation, membership archive, or tenant deletion.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE TYPE "PlatformCapability" AS ENUM (
  'SYSOP_CONSOLE_ACCESS',
  'SYSOP_OVERVIEW_READ',
  'SYSOP_USER_DIRECTORY_READ',
  'SYSOP_USER_MUTATE',
  'SYSOP_USER_SESSION_REVOKE',
  'SYSOP_ROOM_ACCESS_MANAGE',
  'SYSOP_ORGANIZATION_MANAGE',
  'SYSOP_OPERATOR_MANAGE',
  'SYSOP_AUDIT_READ',
  'SYSOP_SECURITY_MANAGE'
);

CREATE TYPE "PlatformAuditAction" AS ENUM (
  'SYSOP_SESSION_STARTED',
  'SYSOP_DIRECTORY_ACCESSED',
  'SYSOP_USER_VIEWED',
  'SYSOP_AUDIT_LOG_VIEWED',
  'SYSOP_AUDIT_LOG_EXPORTED',
  'SYSOP_USER_CREATED',
  'SYSOP_USER_PROFILE_UPDATED',
  'SYSOP_USER_DEACTIVATED',
  'SYSOP_USER_REACTIVATED',
  'SYSOP_USER_SESSION_REVOKED',
  'SYSOP_MEMBERSHIP_GRANTED',
  'SYSOP_MEMBERSHIP_UPDATED',
  'SYSOP_MEMBERSHIP_ARCHIVED',
  'SYSOP_ROOM_ACCESS_GRANTED',
  'SYSOP_ROOM_ACCESS_UPDATED',
  'SYSOP_ROOM_ACCESS_REVOKED',
  'PLATFORM_OPERATOR_GRANTED',
  'PLATFORM_OPERATOR_REVOKED',
  'PLATFORM_OPERATOR_REVOKE_BLOCKED',
  'SYSOP_CAPABILITY_GRANTED',
  'SYSOP_CAPABILITY_REVOKED',
  'SYSOP_ACTION_DENIED',
  'SYSOP_ACTION_FAILED'
);

CREATE TYPE "PlatformAuditOutcome" AS ENUM ('SUCCEEDED', 'DENIED', 'FAILED');

CREATE TABLE "platform_sessions" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "tokenKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mfaVerifiedAt" TIMESTAMP(3) NOT NULL,
  "ipAddress" VARCHAR(50),
  "ipSubnet" VARCHAR(50),
  "userAgentHash" VARCHAR(64),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_sessions_tokenHash_key" ON "platform_sessions"("tokenHash");
CREATE INDEX "platform_sessions_userId_isActive_idx" ON "platform_sessions"("userId", "isActive");
CREATE INDEX "platform_sessions_expiresAt_idx" ON "platform_sessions"("expiresAt");
CREATE INDEX "platform_sessions_isActive_idx" ON "platform_sessions"("isActive");

ALTER TABLE "platform_sessions"
  ADD CONSTRAINT "platform_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_sessions"
  ADD CONSTRAINT "platform_sessions_tokenKeyVersion_positive"
  CHECK ("tokenKeyVersion" >= 1);
ALTER TABLE "platform_sessions"
  ADD CONSTRAINT "platform_sessions_expires_after_created"
  CHECK ("expiresAt" > "createdAt");

CREATE TABLE "platform_capability_grants" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "capability" "PlatformCapability" NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "grantReasonCode" VARCHAR(64) NOT NULL,
  "incidentRef" VARCHAR(128),
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revokeReasonCode" VARCHAR(64),
  CONSTRAINT "platform_capability_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_capability_grants_userId_capability_revokedAt_idx"
  ON "platform_capability_grants"("userId", "capability", "revokedAt");
CREATE INDEX "platform_capability_grants_capability_revokedAt_idx"
  ON "platform_capability_grants"("capability", "revokedAt");
CREATE UNIQUE INDEX "platform_capability_grants_active_unique"
  ON "platform_capability_grants"("userId", "capability")
  WHERE "revokedAt" IS NULL;

ALTER TABLE "platform_capability_grants"
  ADD CONSTRAINT "platform_capability_grants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_capability_grants"
  ADD CONSTRAINT "platform_capability_grants_grantedByUserId_fkey"
  FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_capability_grants"
  ADD CONSTRAINT "platform_capability_grants_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_capability_grants"
  ADD CONSTRAINT "platform_capability_grants_grantReasonCode_not_blank"
  CHECK (length(btrim("grantReasonCode")) > 0);
ALTER TABLE "platform_capability_grants"
  ADD CONSTRAINT "platform_capability_grants_revocation_complete"
  CHECK (
    ("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revokeReasonCode" IS NULL)
    OR
    ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND length(btrim("revokeReasonCode")) > 0)
  );
ALTER TABLE "platform_capability_grants"
  ADD CONSTRAINT "platform_capability_grants_revoked_after_created"
  CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt");

CREATE TABLE "platform_audit_events" (
  "id" TEXT NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "action" "PlatformAuditAction" NOT NULL,
  "outcome" "PlatformAuditOutcome" NOT NULL DEFAULT 'SUCCEEDED',
  "actorUserId" VARCHAR(255),
  "targetUserId" VARCHAR(255),
  "targetOrgId" VARCHAR(255),
  "targetRoomId" VARCHAR(255),
  "requestId" VARCHAR(100) NOT NULL,
  "correlationId" VARCHAR(100),
  "idempotencyKey" VARCHAR(255),
  "platformSessionId" VARCHAR(255),
  "reasonCode" VARCHAR(64),
  "incidentRef" VARCHAR(128),
  "changedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "previousState" VARCHAR(64),
  "nextState" VARCHAR(64),
  "affectedItemCount" INTEGER,
  "ipAddressHash" VARCHAR(64),
  "networkHashKeyVersion" INTEGER,
  "userAgentHash" VARCHAR(64),
  "authStrength" VARCHAR(32),
  "breakGlass" BOOLEAN NOT NULL DEFAULT false,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_audit_events_sequence_key" UNIQUE ("sequence")
);

CREATE UNIQUE INDEX "platform_audit_events_idempotencyKey_key"
  ON "platform_audit_events"("idempotencyKey");
CREATE INDEX "platform_audit_events_occurredAt_id_idx"
  ON "platform_audit_events"("occurredAt", "id");
CREATE INDEX "platform_audit_events_action_occurredAt_idx"
  ON "platform_audit_events"("action", "occurredAt");
CREATE INDEX "platform_audit_events_actorUserId_occurredAt_idx"
  ON "platform_audit_events"("actorUserId", "occurredAt");
CREATE INDEX "platform_audit_events_targetUserId_occurredAt_idx"
  ON "platform_audit_events"("targetUserId", "occurredAt");
CREATE INDEX "platform_audit_events_targetOrgId_occurredAt_idx"
  ON "platform_audit_events"("targetOrgId", "occurredAt");
CREATE INDEX "platform_audit_events_requestId_idx"
  ON "platform_audit_events"("requestId");
CREATE INDEX "platform_audit_events_correlationId_idx"
  ON "platform_audit_events"("correlationId");

-- The ledger is intentionally unable to hold arbitrary free-form metadata.
-- The future database writer further narrows these by action; these structural
-- constraints prevent it becoming a covert content or secret store.
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_affectedItemCount_nonnegative"
  CHECK ("affectedItemCount" IS NULL OR "affectedItemCount" >= 0);
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_schemaVersion_positive"
  CHECK ("schemaVersion" >= 1);
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_networkHashKeyVersion_positive"
  CHECK ("networkHashKeyVersion" IS NULL OR "networkHashKeyVersion" >= 1);
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_changedFields_allowlist"
  CHECK (
    cardinality("changedFields") <= 12
    AND "changedFields" <@ ARRAY[
      'account.isActive', 'user.profile', 'membership.role', 'membership.isActive',
      'membership.archivedAt', 'roomAccess.directGrant', 'operator.capability',
      'session.isActive', 'organization.isActive', 'organization.quota'
    ]::TEXT[]
  );
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_reasonCode_format"
  CHECK ("reasonCode" IS NULL OR "reasonCode" ~ '^[A-Z][A-Z0-9_]{0,63}$');
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_incidentRef_format"
  CHECK ("incidentRef" IS NULL OR "incidentRef" ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$');
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_state_format"
  CHECK (
    ("previousState" IS NULL OR "previousState" ~ '^[A-Z][A-Z0-9_]{0,63}$')
    AND ("nextState" IS NULL OR "nextState" ~ '^[A-Z][A-Z0-9_]{0,63}$')
  );
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_authStrength_format"
  CHECK ("authStrength" IS NULL OR "authStrength" ~ '^[A-Z][A-Z0-9_]{0,31}$');

-- Platform ledger immutability is defense in depth. The follow-up capability
-- migration will grant only reviewed writer/reader functions; this table has
-- no tenant RLS policy and must never be included in tenant activity routes.
CREATE FUNCTION public.prevent_platform_audit_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'PLATFORM_AUDIT_EVENTS_ARE_IMMUTABLE';
END;
$$;

CREATE TRIGGER platform_audit_events_are_immutable
  BEFORE UPDATE OR DELETE ON "platform_audit_events"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_audit_events_mutation();

CREATE FUNCTION public.prevent_platform_audit_events_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'PLATFORM_AUDIT_EVENTS_ARE_IMMUTABLE';
END;
$$;

CREATE TRIGGER platform_audit_events_cannot_be_truncated
  BEFORE TRUNCATE ON "platform_audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_platform_audit_events_truncate();

-- A grant record has a narrow lifecycle: immutable creation followed by one
-- complete revocation transition. It cannot be edited back to active or
-- repurposed for another subject/capability.
CREATE FUNCTION public.prevent_platform_capability_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PLATFORM_CAPABILITY_GRANTS_CANNOT_BE_DELETED';
  END IF;

  IF OLD."revokedAt" IS NOT NULL
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."capability" IS DISTINCT FROM OLD."capability"
    OR NEW."grantedByUserId" IS DISTINCT FROM OLD."grantedByUserId"
    OR NEW."grantReasonCode" IS DISTINCT FROM OLD."grantReasonCode"
    OR NEW."incidentRef" IS DISTINCT FROM OLD."incidentRef"
    OR NEW."revokedAt" IS NULL
    OR NEW."revokedByUserId" IS NULL
    OR NEW."revokeReasonCode" IS NULL THEN
    RAISE EXCEPTION 'PLATFORM_CAPABILITY_GRANT_UPDATE_NOT_ALLOWED';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_capability_grants_lifecycle_only
  BEFORE UPDATE OR DELETE ON "platform_capability_grants"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_capability_grant_mutation();

ALTER TABLE "platform_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_capability_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_capability_grants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_events" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "platform_sessions", "platform_capability_grants", "platform_audit_events" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "platform_audit_events_sequence_seq" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_platform_audit_events_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_platform_audit_events_truncate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_platform_capability_grant_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    REVOKE ALL ON TABLE public.platform_sessions, public.platform_capability_grants, public.platform_audit_events FROM vaultspace_app;
    REVOKE ALL ON SEQUENCE public.platform_audit_events_sequence_seq FROM vaultspace_app;
    IF EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'platform_sessions', 'platform_capability_grants', 'platform_audit_events'
      ]) AS protected_table(table_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]) AS protected_privilege(privilege_name)
      WHERE pg_catalog.has_table_privilege(
        'vaultspace_app',
        'public.' || pg_catalog.quote_ident(protected_table.table_name),
        protected_privilege.privilege_name
      )
    ) THEN
      RAISE EXCEPTION 'PLATFORM_CONTROL_RUNTIME_PRIVILEGE_NOT_DENIED';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'platform_sessions', 'platform_capability_grants', 'platform_audit_events'
      ]) AS protected_table(table_name)
      WHERE pg_catalog.has_any_column_privilege(
        'vaultspace_app',
        'public.' || pg_catalog.quote_ident(protected_table.table_name),
        'SELECT,INSERT,UPDATE,REFERENCES'
      )
    ) THEN
      RAISE EXCEPTION 'PLATFORM_CONTROL_RUNTIME_COLUMN_PRIVILEGE_NOT_DENIED';
    END IF;
    IF pg_catalog.has_sequence_privilege(
      'vaultspace_app', 'public.platform_audit_events_sequence_seq', 'USAGE'
    ) OR pg_catalog.has_sequence_privilege(
      'vaultspace_app', 'public.platform_audit_events_sequence_seq', 'SELECT'
    ) OR pg_catalog.has_sequence_privilege(
      'vaultspace_app', 'public.platform_audit_events_sequence_seq', 'UPDATE'
    ) THEN
      RAISE EXCEPTION 'PLATFORM_CONTROL_RUNTIME_SEQUENCE_PRIVILEGE_NOT_DENIED';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = 'vaultspace_app' AND (rolbypassrls OR rolsuper)
    ) THEN
      RAISE EXCEPTION 'PLATFORM_CONTROL_RUNTIME_ROLE_POSTURE_INVALID';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class protected_table
      JOIN pg_catalog.pg_roles app_role ON app_role.oid = protected_table.relowner
      WHERE app_role.rolname = 'vaultspace_app'
        AND protected_table.relnamespace = 'public'::pg_catalog.regnamespace
        AND protected_table.relname IN (
          'platform_sessions', 'platform_capability_grants', 'platform_audit_events'
        )
    ) THEN
      RAISE EXCEPTION 'PLATFORM_CONTROL_RUNTIME_MUST_NOT_OWN_PROTECTED_TABLES';
    END IF;
  END IF;
END
$$;

COMMENT ON TABLE "platform_audit_events" IS
  'Global append-only SysOp governance ledger. Excluded from tenant RLS, activity, backup, and export paths.';
COMMENT ON TABLE "platform_sessions" IS
  'Platform-only SysOp sessions. Never accepted by tenant routes.';

COMMIT;
