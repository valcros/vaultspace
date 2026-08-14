-- W1-2 Unit 12 is an inert password-reset issuance foundation. It creates
-- three owner-only capability functions, extends the encrypted recovery-row
-- constraint for version 2, and grants no new runtime EXECUTE privilege.
-- The read-only credential and catalog preflight runs before the DDL
-- transaction so a categorical guard is not masked by transaction abort.
SET lock_timeout = '10s';
SET statement_timeout = '120s';

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  unexpected_runtime_function_rows integer;
  current_table_privileges text[];
  current_write_column_privileges text[];
  current_reset_select_column_privileges text[];
  runtime_reset_acl_count integer;
BEGIN
  SELECT oid INTO owner_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_bootstrap_owner'
    AND rolcanlogin IS FALSE
    AND rolinherit IS FALSE
    AND rolsuper IS FALSE
    AND rolbypassrls IS FALSE
    AND rolcreatedb IS FALSE
    AND rolcreaterole IS FALSE
    AND rolreplication IS FALSE;

  IF owner_oid IS NULL OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE roleid = owner_oid OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BOOTSTRAP_OWNER_POSTURE_INVALID';
  END IF;

  SELECT oid INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  IF runtime_oid IS NOT NULL AND runtime_oid = (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_MIGRATION_RUNTIME_CREDENTIAL_FORBIDDEN';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.bootstrap_password_reset_issue_anonymous_v1(text, text, text, text, text, integer, text, bytea, bytea, bytea, text)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.bootstrap_password_reset_admin_recipient_v1(text, text)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.bootstrap_password_reset_issue_admin_single_org_v1(text, text, text, text, text, text, integer, text, bytea, bytea, bytea, text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_ISSUANCE_FUNCTION_PREEXISTING';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  ) INTO current_table_privileges
  FROM information_schema.table_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner';

  IF current_table_privileges IS DISTINCT FROM ARRAY[
    'organizations:SELECT',
    'sessions:SELECT',
    'user_organizations:SELECT',
    'users:SELECT'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_TABLE_PRIVILEGES_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || '.' || privilege.column_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.column_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  ) INTO current_write_column_privileges
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner'
    AND privilege.privilege_type IN ('INSERT', 'UPDATE');

  IF current_write_column_privileges IS DISTINCT FROM ARRAY[
    'organizations.updatedAt:UPDATE',
    'password_reset_recoveries.authTag:UPDATE',
    'password_reset_recoveries.cipherVersion:UPDATE',
    'password_reset_recoveries.ciphertext:UPDATE',
    'password_reset_recoveries.enqueueStatus:UPDATE',
    'password_reset_recoveries.keyId:UPDATE',
    'password_reset_recoveries.nonce:UPDATE',
    'password_reset_recoveries.updatedAt:UPDATE',
    'password_reset_recoveries.wipedAt:UPDATE',
    'password_reset_tokens.usedAt:UPDATE',
    'sessions.createdAt:INSERT',
    'sessions.expiresAt:INSERT',
    'sessions.expiresAt:UPDATE',
    'sessions.id:INSERT',
    'sessions.ipAddress:INSERT',
    'sessions.isActive:INSERT',
    'sessions.isActive:UPDATE',
    'sessions.lastActiveAt:INSERT',
    'sessions.lastActiveAt:UPDATE',
    'sessions.organizationId:INSERT',
    'sessions.token:INSERT',
    'sessions.updatedAt:INSERT',
    'sessions.updatedAt:UPDATE',
    'sessions.userAgent:INSERT',
    'sessions.userId:INSERT',
    'user_organizations.updatedAt:UPDATE',
    'users.passwordHash:UPDATE',
    'users.updatedAt:UPDATE'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_COLUMN_PRIVILEGES_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || '.' || privilege.column_name
      ORDER BY privilege.table_name, privilege.column_name
    ),
    ARRAY[]::text[]
  ) INTO current_reset_select_column_privileges
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner'
    AND privilege.privilege_type = 'SELECT'
    AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries');

  IF current_reset_select_column_privileges IS DISTINCT FROM ARRAY[
    'password_reset_recoveries.flowId',
    'password_reset_recoveries.wipedAt',
    'password_reset_tokens.expiresAt',
    'password_reset_tokens.id',
    'password_reset_tokens.requestId',
    'password_reset_tokens.token',
    'password_reset_tokens.usedAt',
    'password_reset_tokens.userId'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_RESET_SELECT_PRIVILEGES_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS catalog_constraint
    WHERE catalog_constraint.conrelid = 'public.password_reset_recoveries'::pg_catalog.regclass
      AND catalog_constraint.conname = 'password_reset_recoveries_envelope_complete'
      AND pg_catalog.pg_get_constraintdef(catalog_constraint.oid) LIKE '%"cipherVersion" = 1%'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_RECOVERY_CONSTRAINT_PRESTATE_INVALID';
  END IF;

  IF runtime_oid IS NULL THEN
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO unexpected_runtime_function_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
    AND pg_catalog.has_function_privilege(runtime_oid, function.oid, 'EXECUTE')
    AND function.oid NOT IN (
      pg_catalog.to_regprocedure('public.bootstrap_login_candidate_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_resolve_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_organization_resolve_v1(text, text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_refresh_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_invalidate_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_revoke_self_others_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_revoke_admin_user_org_v1(text, text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)'),
      pg_catalog.to_regprocedure('public.bootstrap_password_reset_candidate_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_password_reset_redeem_v1(text, text)')
    );

  IF unexpected_runtime_function_rows <> 0 OR NOT (
    pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_login_candidate_v1(text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_session_resolve_v1(text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_organization_resolve_v1(text, text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_session_refresh_v1(text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_session_invalidate_v1(text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_session_revoke_self_others_v1(text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_session_revoke_admin_user_org_v1(text, text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_password_reset_candidate_v1(text)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(runtime_oid, 'public.bootstrap_password_reset_redeem_v1(text, text)', 'EXECUTE')
  ) OR pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_revoke_user_org_v1(text, text)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_revoke_user_global_v1(text, text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_PREEXISTING_MATRIX_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO runtime_reset_acl_count
  FROM (
    SELECT 'table:' || privilege.table_name || ':' || privilege.privilege_type AS acl_key
    FROM information_schema.table_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
      AND privilege.grantee = 'vaultspace_app'
    UNION
    SELECT 'column:' || privilege.table_name || '.' || privilege.column_name || ':' || privilege.privilege_type
    FROM information_schema.column_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
      AND privilege.grantee = 'vaultspace_app'
  ) AS runtime_acl;

  IF runtime_reset_acl_count <> 152 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_RESET_PRIVILEGE_PRESTATE_INVALID';
  END IF;
END
$$;

BEGIN;

CREATE TEMPORARY TABLE unit12_runtime_reset_acl_prestate (
  acl_key text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO unit12_runtime_reset_acl_prestate (acl_key)
SELECT acl_key
FROM (
  SELECT 'table:' || privilege.table_name || ':' || privilege.privilege_type AS acl_key
  FROM information_schema.table_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
    AND privilege.grantee = 'vaultspace_app'
  UNION
  SELECT 'column:' || privilege.table_name || '.' || privilege.column_name || ':' || privilege.privilege_type
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
    AND privilege.grantee = 'vaultspace_app'
) AS runtime_acl;

ALTER TABLE public.password_reset_recoveries
  DROP CONSTRAINT password_reset_recoveries_envelope_complete,
  ADD CONSTRAINT password_reset_recoveries_envelope_complete CHECK (
    (
      "cipherVersion" IS NULL
      AND "keyId" IS NULL
      AND nonce IS NULL
      AND ciphertext IS NULL
      AND "authTag" IS NULL
    ) OR (
      "cipherVersion" IN (1, 2)
      AND "keyId" IS NOT NULL
      AND pg_catalog.octet_length(nonce) = 12
      AND pg_catalog.octet_length("authTag") = 16
      AND pg_catalog.octet_length(ciphertext) BETWEEN 48 AND 128
    )
  );

GRANT SELECT ("createdAt")
ON public.password_reset_tokens TO vaultspace_bootstrap_owner;

GRANT INSERT (
  id,
  "userId",
  token,
  "expiresAt",
  "requestId",
  "organizationId",
  "deliveryStatus",
  "auditOrganizationIds",
  "providerCorrelationSchemaVersion"
) ON public.password_reset_tokens TO vaultspace_bootstrap_owner;

GRANT INSERT (
  "flowId",
  "userId",
  "recipientFingerprint",
  "cipherVersion",
  "keyId",
  nonce,
  ciphertext,
  "authTag",
  "providerOperationId",
  "updatedAt"
) ON public.password_reset_recoveries TO vaultspace_bootstrap_owner;

CREATE FUNCTION public.bootstrap_password_reset_issue_anonymous_v1(
  input_normalized_email text,
  input_requested_sender_org_slug text,
  input_flow_id text,
  input_stored_token text,
  input_request_id text,
  input_cipher_version integer,
  input_key_id text,
  input_nonce bytea,
  input_ciphertext bytea,
  input_auth_tag bytea,
  input_recipient_fingerprint text
)
RETURNS TABLE (
  authorization_proven boolean,
  flow_id text,
  audit_organization_ids text[],
  superseded_flow_ids text[],
  superseded_request_ids text[]
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  statement_time timestamptz := pg_catalog.statement_timestamp();
  candidate_user_id text;
  locked_user_id text;
  locked_active_membership_count integer := 0;
  sender_organization_id text;
  audit_organization_values text[] := ARRAY[]::text[];
  superseded_flow_values text[] := ARRAY[]::text[];
  superseded_request_values text[] := ARRAY[]::text[];
BEGIN
  IF input_normalized_email IS NULL
    OR pg_catalog.char_length(input_normalized_email) > 255
    OR input_normalized_email <> pg_catalog.lower(pg_catalog.btrim(input_normalized_email))
    OR NOT input_normalized_email OPERATOR(pg_catalog.~) '^[^[:space:]@]+@[^[:space:]@]+$'
    OR (
      input_requested_sender_org_slug IS NOT NULL
      AND (
        pg_catalog.char_length(input_requested_sender_org_slug) NOT BETWEEN 1 AND 100
        OR NOT input_requested_sender_org_slug OPERATOR(pg_catalog.~)
          '^[a-z0-9]+(-[a-z0-9]+)*$'
      )
    )
    OR input_flow_id IS NULL
    OR pg_catalog.char_length(input_flow_id) NOT BETWEEN 1 AND 255
    OR NOT input_flow_id OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]+$'
    OR input_stored_token IS NULL
    OR NOT input_stored_token OPERATOR(pg_catalog.~) '^prh1:[a-f0-9]{64}$'
    OR input_request_id IS NULL
    OR pg_catalog.char_length(input_request_id) NOT BETWEEN 1 AND 100
    OR input_request_id OPERATOR(pg_catalog.~) '[[:cntrl:]]'
    OR input_cipher_version IS DISTINCT FROM 2
    OR input_key_id IS NULL
    OR pg_catalog.char_length(input_key_id) NOT BETWEEN 1 AND 64
    OR NOT input_key_id OPERATOR(pg_catalog.~) '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    OR input_nonce IS NULL
    OR pg_catalog.octet_length(input_nonce) <> 12
    OR input_ciphertext IS NULL
    OR pg_catalog.octet_length(input_ciphertext) NOT BETWEEN 48 AND 128
    OR input_auth_tag IS NULL
    OR pg_catalog.octet_length(input_auth_tag) <> 16
    OR input_recipient_fingerprint IS NULL
    OR NOT input_recipient_fingerprint OPERATOR(pg_catalog.~) '^[a-f0-9]{64}$'
  THEN
    RETURN;
  END IF;

  SELECT candidate_user.id INTO candidate_user_id
  FROM public.users AS candidate_user
  WHERE candidate_user.email = input_normalized_email
    AND candidate_user."isActive" IS TRUE;

  IF candidate_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vaultspace/password-reset/user/' || candidate_user_id, 0)
  );

  SELECT candidate_user.id INTO locked_user_id
  FROM public.users AS candidate_user
  WHERE candidate_user.id = candidate_user_id
    AND candidate_user.email = input_normalized_email
    AND candidate_user."isActive" IS TRUE
  FOR UPDATE OF candidate_user;

  IF locked_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM 1
  FROM public.user_organizations AS membership
  WHERE membership."userId" = locked_user_id
  ORDER BY membership."organizationId" COLLATE pg_catalog."C", membership.id COLLATE pg_catalog."C"
  FOR UPDATE OF membership;

  PERFORM 1
  FROM public.user_organizations AS membership
  INNER JOIN public.organizations AS organization
    ON organization.id = membership."organizationId"
  WHERE membership."userId" = locked_user_id
  ORDER BY organization.id COLLATE pg_catalog."C"
  FOR UPDATE OF organization;

  SELECT
    pg_catalog.count(*)::integer,
    COALESCE(
      pg_catalog.array_agg(
        membership."organizationId"::pg_catalog.text
        ORDER BY membership."organizationId" COLLATE pg_catalog."C"
      ),
      ARRAY[]::text[]
    )
    INTO locked_active_membership_count, audit_organization_values
  FROM public.user_organizations AS membership
  INNER JOIN public.organizations AS organization
    ON organization.id = membership."organizationId"
   AND organization."isActive" IS TRUE
  WHERE membership."userId" = locked_user_id
    AND membership."isActive" IS TRUE;

  IF locked_active_membership_count < 1 OR locked_active_membership_count > 64 THEN
    RETURN;
  END IF;

  IF input_requested_sender_org_slug IS NOT NULL THEN
    SELECT organization.id INTO sender_organization_id
    FROM public.user_organizations AS membership
    INNER JOIN public.organizations AS organization
      ON organization.id = membership."organizationId"
     AND organization."isActive" IS TRUE
    WHERE membership."userId" = locked_user_id
      AND membership."isActive" IS TRUE
      AND organization.slug = input_requested_sender_org_slug;
  END IF;

  IF sender_organization_id IS NULL AND locked_active_membership_count = 1 THEN
    sender_organization_id := audit_organization_values[1];
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.password_reset_tokens AS recent_reset
    WHERE recent_reset."userId" = locked_user_id
      AND recent_reset."usedAt" IS NULL
      AND recent_reset."createdAt" > statement_time - pg_catalog.make_interval(mins => 1)
  ) THEN
    RETURN;
  END IF;

  PERFORM 1
  FROM public.password_reset_tokens AS existing_reset
  WHERE existing_reset."userId" = locked_user_id
    AND existing_reset."usedAt" IS NULL
  ORDER BY existing_reset.id COLLATE pg_catalog."C"
  FOR UPDATE OF existing_reset;

  SELECT
    COALESCE(
      pg_catalog.array_agg(existing_reset.id::pg_catalog.text ORDER BY existing_reset.id COLLATE pg_catalog."C"),
      ARRAY[]::text[]
    ),
    COALESCE(
      pg_catalog.array_agg(existing_reset."requestId"::pg_catalog.text ORDER BY existing_reset.id COLLATE pg_catalog."C"),
      ARRAY[]::text[]
    )
    INTO superseded_flow_values, superseded_request_values
  FROM public.password_reset_tokens AS existing_reset
  WHERE existing_reset."userId" = locked_user_id
    AND existing_reset."usedAt" IS NULL;

  PERFORM 1
  FROM public.password_reset_recoveries AS recovery
  WHERE recovery."flowId" = ANY(superseded_flow_values)
  ORDER BY recovery."flowId" COLLATE pg_catalog."C"
  FOR UPDATE OF recovery;

  UPDATE public.password_reset_tokens AS existing_reset
  SET "usedAt" = statement_time
  WHERE existing_reset.id = ANY(superseded_flow_values)
    AND existing_reset."userId" = locked_user_id
    AND existing_reset."usedAt" IS NULL;

  UPDATE public.password_reset_recoveries AS recovery
  SET
    "cipherVersion" = NULL,
    "keyId" = NULL,
    nonce = NULL,
    ciphertext = NULL,
    "authTag" = NULL,
    "wipedAt" = statement_time,
    "enqueueStatus" = 'SUPERSEDED',
    "updatedAt" = statement_time
  WHERE recovery."flowId" = ANY(superseded_flow_values)
    AND recovery."wipedAt" IS NULL;

  INSERT INTO public.password_reset_tokens (
    id,
    "userId",
    token,
    "expiresAt",
    "requestId",
    "organizationId",
    "deliveryStatus",
    "auditOrganizationIds",
    "providerCorrelationSchemaVersion"
  ) VALUES (
    input_flow_id,
    locked_user_id,
    input_stored_token,
    statement_time + pg_catalog.make_interval(hours => 1),
    input_request_id,
    sender_organization_id,
    'PENDING',
    audit_organization_values,
    1
  );

  INSERT INTO public.password_reset_recoveries (
    "flowId",
    "userId",
    "recipientFingerprint",
    "cipherVersion",
    "keyId",
    nonce,
    ciphertext,
    "authTag",
    "providerOperationId",
    "updatedAt"
  ) VALUES (
    input_flow_id,
    locked_user_id,
    input_recipient_fingerprint,
    2,
    input_key_id,
    input_nonce,
    input_ciphertext,
    input_auth_tag,
    input_flow_id,
    statement_time
  );

  authorization_proven := true;
  flow_id := input_flow_id;
  audit_organization_ids := audit_organization_values;
  superseded_flow_ids := superseded_flow_values;
  superseded_request_ids := superseded_request_values;
  RETURN NEXT;
END
$function$;

CREATE FUNCTION public.bootstrap_password_reset_admin_recipient_v1(
  input_actor_token text,
  input_target_user_id text
)
RETURNS TABLE (
  authorization_proven boolean,
  recipient_email text
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH authorized_actor AS MATERIALIZED (
    SELECT actor_session."organizationId" AS actor_organization_id
    FROM public.sessions AS actor_session
    INNER JOIN public.users AS actor_user
      ON actor_user.id = actor_session."userId"
     AND actor_user."isActive" IS TRUE
    INNER JOIN public.user_organizations AS actor_membership
      ON actor_membership."userId" = actor_session."userId"
     AND actor_membership."organizationId" = actor_session."organizationId"
     AND actor_membership."isActive" IS TRUE
     AND actor_membership.role::pg_catalog.text = 'ADMIN'
    INNER JOIN public.organizations AS actor_organization
      ON actor_organization.id = actor_session."organizationId"
     AND actor_organization."isActive" IS TRUE
    WHERE input_actor_token IS NOT NULL
      AND pg_catalog.char_length(input_actor_token) = 43
      AND input_actor_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
      AND actor_session.token = input_actor_token
      AND actor_session."isActive" IS TRUE
      AND actor_session."organizationId" IS NOT NULL
      AND actor_session."expiresAt" > pg_catalog.statement_timestamp()
      AND actor_session."createdAt" + pg_catalog.make_interval(days => 7)
        >= pg_catalog.statement_timestamp()
  ),
  target_membership_inventory AS MATERIALIZED (
    SELECT
      pg_catalog.count(*)::integer AS membership_count,
      pg_catalog.min(membership."organizationId") AS target_organization_id
    FROM public.user_organizations AS membership
    WHERE input_target_user_id IS NOT NULL
      AND pg_catalog.char_length(input_target_user_id) BETWEEN 1 AND 255
      AND membership."userId" = input_target_user_id
  )
  SELECT
    true AS authorization_proven,
    target_user.email::pg_catalog.text AS recipient_email
  FROM authorized_actor
  CROSS JOIN target_membership_inventory
  INNER JOIN public.user_organizations AS target_membership
    ON target_membership."userId" = input_target_user_id
   AND target_membership."organizationId" = target_membership_inventory.target_organization_id
   AND target_membership."isActive" IS TRUE
  INNER JOIN public.users AS target_user
    ON target_user.id = target_membership."userId"
   AND target_user."isActive" IS TRUE
  INNER JOIN public.organizations AS target_organization
    ON target_organization.id = target_membership."organizationId"
   AND target_organization."isActive" IS TRUE
  WHERE target_membership_inventory.membership_count = 1
    AND target_membership_inventory.target_organization_id = authorized_actor.actor_organization_id
    AND target_user.email = pg_catalog.lower(pg_catalog.btrim(target_user.email))
    AND pg_catalog.char_length(target_user.email) <= 255
    AND target_user.email OPERATOR(pg_catalog.~) '^[^[:space:]@]+@[^[:space:]@]+$'
$function$;

CREATE FUNCTION public.bootstrap_password_reset_issue_admin_single_org_v1(
  input_actor_token text,
  input_target_user_id text,
  input_expected_normalized_email text,
  input_flow_id text,
  input_stored_token text,
  input_request_id text,
  input_cipher_version integer,
  input_key_id text,
  input_nonce bytea,
  input_ciphertext bytea,
  input_auth_tag bytea,
  input_recipient_fingerprint text
)
RETURNS TABLE (
  authorization_proven boolean,
  flow_id text,
  audit_organization_ids text[],
  superseded_flow_ids text[],
  superseded_request_ids text[]
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  statement_time timestamptz := pg_catalog.statement_timestamp();
  candidate_actor_user_id text;
  candidate_actor_session_id text;
  candidate_actor_organization_id text;
  authorized_organization_id text;
  target_membership_count integer := 0;
  superseded_flow_values text[] := ARRAY[]::text[];
  superseded_request_values text[] := ARRAY[]::text[];
BEGIN
  IF input_actor_token IS NULL
    OR pg_catalog.char_length(input_actor_token) <> 43
    OR NOT input_actor_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
    OR input_target_user_id IS NULL
    OR pg_catalog.char_length(input_target_user_id) NOT BETWEEN 1 AND 255
    OR NOT input_target_user_id OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]+$'
    OR input_expected_normalized_email IS NULL
    OR pg_catalog.char_length(input_expected_normalized_email) > 255
    OR input_expected_normalized_email <> pg_catalog.lower(pg_catalog.btrim(input_expected_normalized_email))
    OR NOT input_expected_normalized_email OPERATOR(pg_catalog.~) '^[^[:space:]@]+@[^[:space:]@]+$'
    OR input_flow_id IS NULL
    OR pg_catalog.char_length(input_flow_id) NOT BETWEEN 1 AND 255
    OR NOT input_flow_id OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]+$'
    OR input_stored_token IS NULL
    OR NOT input_stored_token OPERATOR(pg_catalog.~) '^prh1:[a-f0-9]{64}$'
    OR input_request_id IS NULL
    OR pg_catalog.char_length(input_request_id) NOT BETWEEN 1 AND 100
    OR input_request_id OPERATOR(pg_catalog.~) '[[:cntrl:]]'
    OR input_cipher_version IS DISTINCT FROM 2
    OR input_key_id IS NULL
    OR pg_catalog.char_length(input_key_id) NOT BETWEEN 1 AND 64
    OR NOT input_key_id OPERATOR(pg_catalog.~) '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    OR input_nonce IS NULL
    OR pg_catalog.octet_length(input_nonce) <> 12
    OR input_ciphertext IS NULL
    OR pg_catalog.octet_length(input_ciphertext) NOT BETWEEN 48 AND 128
    OR input_auth_tag IS NULL
    OR pg_catalog.octet_length(input_auth_tag) <> 16
    OR input_recipient_fingerprint IS NULL
    OR NOT input_recipient_fingerprint OPERATOR(pg_catalog.~) '^[a-f0-9]{64}$'
  THEN
    RETURN;
  END IF;

  SELECT
    actor_session."userId",
    actor_session.id,
    actor_session."organizationId"
    INTO candidate_actor_user_id, candidate_actor_session_id, candidate_actor_organization_id
  FROM public.sessions AS actor_session
  WHERE actor_session.token = input_actor_token;

  IF candidate_actor_user_id IS NULL OR candidate_actor_organization_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vaultspace/password-reset/user/' || input_target_user_id, 0)
  );

  PERFORM 1
  FROM public.users AS locked_user
  WHERE locked_user.id IN (candidate_actor_user_id, input_target_user_id)
  ORDER BY locked_user.id COLLATE pg_catalog."C"
  FOR UPDATE OF locked_user;

  PERFORM 1
  FROM public.sessions AS actor_session
  WHERE actor_session.id = candidate_actor_session_id
  FOR UPDATE OF actor_session;

  PERFORM 1
  FROM public.user_organizations AS target_membership
  WHERE target_membership."userId" = input_target_user_id
  ORDER BY target_membership."organizationId" COLLATE pg_catalog."C", target_membership.id COLLATE pg_catalog."C"
  FOR UPDATE OF target_membership;

  PERFORM 1
  FROM public.user_organizations AS actor_membership
  WHERE actor_membership."userId" = candidate_actor_user_id
    AND actor_membership."organizationId" = candidate_actor_organization_id
  FOR UPDATE OF actor_membership;

  PERFORM 1
  FROM public.organizations AS organization
  WHERE organization.id = candidate_actor_organization_id
  FOR UPDATE OF organization;

  SELECT pg_catalog.count(*)::integer INTO target_membership_count
  FROM public.user_organizations AS target_inventory
  WHERE target_inventory."userId" = input_target_user_id;

  IF target_membership_count <> 1 THEN
    RETURN;
  END IF;

  SELECT actor_session."organizationId" INTO authorized_organization_id
  FROM public.sessions AS actor_session
  INNER JOIN public.users AS actor_user
    ON actor_user.id = actor_session."userId"
   AND actor_user."isActive" IS TRUE
  INNER JOIN public.user_organizations AS actor_membership
    ON actor_membership."userId" = actor_session."userId"
   AND actor_membership."organizationId" = actor_session."organizationId"
   AND actor_membership."isActive" IS TRUE
   AND actor_membership.role::pg_catalog.text = 'ADMIN'
  INNER JOIN public.organizations AS actor_organization
    ON actor_organization.id = actor_session."organizationId"
   AND actor_organization."isActive" IS TRUE
  INNER JOIN public.user_organizations AS target_membership
    ON target_membership."userId" = input_target_user_id
   AND target_membership."organizationId" = actor_session."organizationId"
   AND target_membership."isActive" IS TRUE
  INNER JOIN public.users AS target_user
    ON target_user.id = target_membership."userId"
   AND target_user."isActive" IS TRUE
   AND target_user.email = input_expected_normalized_email
  WHERE actor_session.id = candidate_actor_session_id
    AND actor_session.token = input_actor_token
    AND actor_session."isActive" IS TRUE
    AND actor_session."organizationId" = candidate_actor_organization_id
    AND actor_session."expiresAt" > statement_time
    AND actor_session."createdAt" + pg_catalog.make_interval(days => 7) >= statement_time;

  IF authorized_organization_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.password_reset_tokens AS recent_reset
    WHERE recent_reset."userId" = input_target_user_id
      AND recent_reset."usedAt" IS NULL
      AND recent_reset."createdAt" > statement_time - pg_catalog.make_interval(mins => 1)
  ) THEN
    RETURN;
  END IF;

  PERFORM 1
  FROM public.password_reset_tokens AS existing_reset
  WHERE existing_reset."userId" = input_target_user_id
    AND existing_reset."usedAt" IS NULL
  ORDER BY existing_reset.id COLLATE pg_catalog."C"
  FOR UPDATE OF existing_reset;

  SELECT
    COALESCE(
      pg_catalog.array_agg(existing_reset.id::pg_catalog.text ORDER BY existing_reset.id COLLATE pg_catalog."C"),
      ARRAY[]::text[]
    ),
    COALESCE(
      pg_catalog.array_agg(existing_reset."requestId"::pg_catalog.text ORDER BY existing_reset.id COLLATE pg_catalog."C"),
      ARRAY[]::text[]
    )
    INTO superseded_flow_values, superseded_request_values
  FROM public.password_reset_tokens AS existing_reset
  WHERE existing_reset."userId" = input_target_user_id
    AND existing_reset."usedAt" IS NULL;

  PERFORM 1
  FROM public.password_reset_recoveries AS recovery
  WHERE recovery."flowId" = ANY(superseded_flow_values)
  ORDER BY recovery."flowId" COLLATE pg_catalog."C"
  FOR UPDATE OF recovery;

  UPDATE public.password_reset_tokens AS existing_reset
  SET "usedAt" = statement_time
  WHERE existing_reset.id = ANY(superseded_flow_values)
    AND existing_reset."userId" = input_target_user_id
    AND existing_reset."usedAt" IS NULL;

  UPDATE public.password_reset_recoveries AS recovery
  SET
    "cipherVersion" = NULL,
    "keyId" = NULL,
    nonce = NULL,
    ciphertext = NULL,
    "authTag" = NULL,
    "wipedAt" = statement_time,
    "enqueueStatus" = 'SUPERSEDED',
    "updatedAt" = statement_time
  WHERE recovery."flowId" = ANY(superseded_flow_values)
    AND recovery."wipedAt" IS NULL;

  INSERT INTO public.password_reset_tokens (
    id,
    "userId",
    token,
    "expiresAt",
    "requestId",
    "organizationId",
    "deliveryStatus",
    "auditOrganizationIds",
    "providerCorrelationSchemaVersion"
  ) VALUES (
    input_flow_id,
    input_target_user_id,
    input_stored_token,
    statement_time + pg_catalog.make_interval(hours => 1),
    input_request_id,
    authorized_organization_id,
    'PENDING',
    ARRAY[authorized_organization_id]::text[],
    1
  );

  INSERT INTO public.password_reset_recoveries (
    "flowId",
    "userId",
    "recipientFingerprint",
    "cipherVersion",
    "keyId",
    nonce,
    ciphertext,
    "authTag",
    "providerOperationId",
    "updatedAt"
  ) VALUES (
    input_flow_id,
    input_target_user_id,
    input_recipient_fingerprint,
    2,
    input_key_id,
    input_nonce,
    input_ciphertext,
    input_auth_tag,
    input_flow_id,
    statement_time
  );

  authorization_proven := true;
  flow_id := input_flow_id;
  audit_organization_ids := ARRAY[authorized_organization_id]::text[];
  superseded_flow_ids := superseded_flow_values;
  superseded_request_ids := superseded_request_values;
  RETURN NEXT;
END
$function$;

COMMENT ON FUNCTION public.bootstrap_password_reset_issue_anonymous_v1(
  text, text, text, text, text, integer, text, bytea, bytea, bytea, text
) IS 'vaultspace-contract:w1-2-password-reset-issue-anonymous-v1';

COMMENT ON FUNCTION public.bootstrap_password_reset_admin_recipient_v1(text, text) IS
  'vaultspace-contract:w1-2-password-reset-admin-recipient-v1';

COMMENT ON FUNCTION public.bootstrap_password_reset_issue_admin_single_org_v1(
  text, text, text, text, text, text, integer, text, bytea, bytea, bytea, text
) IS 'vaultspace-contract:w1-2-password-reset-issue-admin-single-org-v1';

REVOKE ALL ON FUNCTION public.bootstrap_password_reset_issue_anonymous_v1(
  text, text, text, text, text, integer, text, bytea, bytea, bytea, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_password_reset_admin_recipient_v1(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_password_reset_issue_admin_single_org_v1(
  text, text, text, text, text, text, integer, text, bytea, bytea, bytea, text
) FROM PUBLIC;

DO $$
DECLARE
  temporary_membership boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    REVOKE ALL ON FUNCTION public.bootstrap_password_reset_issue_anonymous_v1(
      text, text, text, text, text, integer, text, bytea, bytea, bytea, text
    ) FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_password_reset_admin_recipient_v1(text, text)
      FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_password_reset_issue_admin_single_org_v1(
      text, text, text, text, text, text, integer, text, bytea, bytea, bytea, text
    ) FROM vaultspace_app;
  END IF;

  GRANT CREATE ON SCHEMA public TO vaultspace_bootstrap_owner;
  IF NOT pg_catalog.pg_has_role(CURRENT_USER, 'vaultspace_bootstrap_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT vaultspace_bootstrap_owner TO %I', CURRENT_USER);
    temporary_membership := true;
  END IF;

  ALTER FUNCTION public.bootstrap_password_reset_issue_anonymous_v1(
    text, text, text, text, text, integer, text, bytea, bytea, bytea, text
  ) OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_password_reset_admin_recipient_v1(text, text)
    OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_password_reset_issue_admin_single_org_v1(
    text, text, text, text, text, text, integer, text, bytea, bytea, bytea, text
  ) OWNER TO vaultspace_bootstrap_owner;

  IF temporary_membership THEN
    EXECUTE pg_catalog.format('REVOKE vaultspace_bootstrap_owner FROM %I', CURRENT_USER);
  END IF;
  REVOKE CREATE ON SCHEMA public FROM vaultspace_bootstrap_owner;
END
$$;

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  invalid_function_rows integer;
  unexpected_acl_rows integer;
  unexpected_runtime_function_rows integer;
  current_table_privileges text[];
  current_write_column_privileges text[];
  current_reset_select_column_privileges text[];
  expected_runtime_reset_acl text[];
  current_runtime_reset_acl text[];
BEGIN
  SELECT oid INTO owner_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_bootstrap_owner'
    AND rolcanlogin IS FALSE
    AND rolinherit IS FALSE
    AND rolsuper IS FALSE
    AND rolbypassrls IS FALSE
    AND rolcreatedb IS FALSE
    AND rolcreaterole IS FALSE
    AND rolreplication IS FALSE;

  IF owner_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid = owner_oid OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_MEMBERSHIP_RESTORE_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  ) INTO current_table_privileges
  FROM information_schema.table_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner';

  IF current_table_privileges IS DISTINCT FROM ARRAY[
    'organizations:SELECT',
    'sessions:SELECT',
    'user_organizations:SELECT',
    'users:SELECT'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_TABLE_PRIVILEGES_FINAL_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || '.' || privilege.column_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.column_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  ) INTO current_write_column_privileges
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner'
    AND privilege.privilege_type IN ('INSERT', 'UPDATE');

  IF current_write_column_privileges IS DISTINCT FROM ARRAY[
    'organizations.updatedAt:UPDATE',
    'password_reset_recoveries.authTag:INSERT',
    'password_reset_recoveries.authTag:UPDATE',
    'password_reset_recoveries.cipherVersion:INSERT',
    'password_reset_recoveries.cipherVersion:UPDATE',
    'password_reset_recoveries.ciphertext:INSERT',
    'password_reset_recoveries.ciphertext:UPDATE',
    'password_reset_recoveries.enqueueStatus:UPDATE',
    'password_reset_recoveries.flowId:INSERT',
    'password_reset_recoveries.keyId:INSERT',
    'password_reset_recoveries.keyId:UPDATE',
    'password_reset_recoveries.nonce:INSERT',
    'password_reset_recoveries.nonce:UPDATE',
    'password_reset_recoveries.providerOperationId:INSERT',
    'password_reset_recoveries.recipientFingerprint:INSERT',
    'password_reset_recoveries.updatedAt:INSERT',
    'password_reset_recoveries.updatedAt:UPDATE',
    'password_reset_recoveries.userId:INSERT',
    'password_reset_recoveries.wipedAt:UPDATE',
    'password_reset_tokens.auditOrganizationIds:INSERT',
    'password_reset_tokens.deliveryStatus:INSERT',
    'password_reset_tokens.expiresAt:INSERT',
    'password_reset_tokens.id:INSERT',
    'password_reset_tokens.organizationId:INSERT',
    'password_reset_tokens.providerCorrelationSchemaVersion:INSERT',
    'password_reset_tokens.requestId:INSERT',
    'password_reset_tokens.token:INSERT',
    'password_reset_tokens.usedAt:UPDATE',
    'password_reset_tokens.userId:INSERT',
    'sessions.createdAt:INSERT',
    'sessions.expiresAt:INSERT',
    'sessions.expiresAt:UPDATE',
    'sessions.id:INSERT',
    'sessions.ipAddress:INSERT',
    'sessions.isActive:INSERT',
    'sessions.isActive:UPDATE',
    'sessions.lastActiveAt:INSERT',
    'sessions.lastActiveAt:UPDATE',
    'sessions.organizationId:INSERT',
    'sessions.token:INSERT',
    'sessions.updatedAt:INSERT',
    'sessions.updatedAt:UPDATE',
    'sessions.userAgent:INSERT',
    'sessions.userId:INSERT',
    'user_organizations.updatedAt:UPDATE',
    'users.passwordHash:UPDATE',
    'users.updatedAt:UPDATE'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_COLUMN_PRIVILEGES_FINAL_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || '.' || privilege.column_name
      ORDER BY privilege.table_name, privilege.column_name
    ),
    ARRAY[]::text[]
  ) INTO current_reset_select_column_privileges
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner'
    AND privilege.privilege_type = 'SELECT'
    AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries');

  IF current_reset_select_column_privileges IS DISTINCT FROM ARRAY[
    'password_reset_recoveries.flowId',
    'password_reset_recoveries.wipedAt',
    'password_reset_tokens.createdAt',
    'password_reset_tokens.expiresAt',
    'password_reset_tokens.id',
    'password_reset_tokens.requestId',
    'password_reset_tokens.token',
    'password_reset_tokens.usedAt',
    'password_reset_tokens.userId'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_RESET_SELECT_PRIVILEGES_FINAL_INVALID';
  END IF;

  IF pg_catalog.has_table_privilege(owner_oid, 'public.password_reset_tokens', 'INSERT, UPDATE, DELETE')
    OR pg_catalog.has_table_privilege(owner_oid, 'public.password_reset_recoveries', 'INSERT, UPDATE, DELETE')
    OR pg_catalog.has_table_privilege(owner_oid, 'public.sessions', 'INSERT, UPDATE, DELETE')
    OR pg_catalog.has_table_privilege(owner_oid, 'public.users', 'INSERT, UPDATE, DELETE')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_TABLE_WRITE_FINAL_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO invalid_function_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
  INNER JOIN pg_catalog.pg_roles AS owner ON owner.oid = function.proowner
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function.prolang
  INNER JOIN (
    VALUES
      (
        'bootstrap_password_reset_issue_anonymous_v1',
        'input_normalized_email text, input_requested_sender_org_slug text, input_flow_id text, input_stored_token text, input_request_id text, input_cipher_version integer, input_key_id text, input_nonce bytea, input_ciphertext bytea, input_auth_tag bytea, input_recipient_fingerprint text',
        'plpgsql',
        'v',
        '5f6f28595a24f218dfe2afda96a67eef',
        'TABLE(authorization_proven boolean, flow_id text, audit_organization_ids text[], superseded_flow_ids text[], superseded_request_ids text[])',
        'vaultspace-contract:w1-2-password-reset-issue-anonymous-v1'
      ),
      (
        'bootstrap_password_reset_admin_recipient_v1',
        'input_actor_token text, input_target_user_id text',
        'sql',
        's',
        '66d39e5da1e0d1ec3d5183a3abdce0fe',
        'TABLE(authorization_proven boolean, recipient_email text)',
        'vaultspace-contract:w1-2-password-reset-admin-recipient-v1'
      ),
      (
        'bootstrap_password_reset_issue_admin_single_org_v1',
        'input_actor_token text, input_target_user_id text, input_expected_normalized_email text, input_flow_id text, input_stored_token text, input_request_id text, input_cipher_version integer, input_key_id text, input_nonce bytea, input_ciphertext bytea, input_auth_tag bytea, input_recipient_fingerprint text',
        'plpgsql',
        'v',
        'bbfbfca5c550275c6636c7c65cb1e589',
        'TABLE(authorization_proven boolean, flow_id text, audit_organization_ids text[], superseded_flow_ids text[], superseded_request_ids text[])',
        'vaultspace-contract:w1-2-password-reset-issue-admin-single-org-v1'
      )
  ) AS expected(
    function_name,
    identity_arguments,
    language_name,
    volatility,
    source_md5,
    function_result,
    contract_comment
  )
    ON expected.function_name = function.proname
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      'bootstrap_password_reset_issue_anonymous_v1',
      'bootstrap_password_reset_admin_recipient_v1',
      'bootstrap_password_reset_issue_admin_single_org_v1'
    )
    AND (
      owner.rolname <> 'vaultspace_bootstrap_owner'
      OR pg_catalog.pg_get_function_identity_arguments(function.oid) <> expected.identity_arguments
      OR language.lanname <> expected.language_name
      OR function.prosecdef IS DISTINCT FROM true
      OR function.provolatile <> expected.volatility::"char"
      OR function.proparallel <> 'u'
      OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR pg_catalog.md5(function.prosrc) <> expected.source_md5
      OR pg_catalog.pg_get_function_result(function.oid) <> expected.function_result
      OR pg_catalog.obj_description(function.oid, 'pg_proc') <> expected.contract_comment
    );

  IF invalid_function_rows <> 0 OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname IN (
        'bootstrap_password_reset_issue_anonymous_v1',
        'bootstrap_password_reset_admin_recipient_v1',
        'bootstrap_password_reset_issue_admin_single_org_v1'
      )
  ) <> 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_ISSUANCE_FUNCTION_POSTURE_INVALID';
  END IF;

  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app';
  SELECT pg_catalog.count(*)::integer INTO unexpected_acl_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
  ) AS acl
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      'bootstrap_password_reset_issue_anonymous_v1',
      'bootstrap_password_reset_admin_recipient_v1',
      'bootstrap_password_reset_issue_admin_single_org_v1'
    )
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> owner_oid;

  IF unexpected_acl_rows <> 0 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS acl
    WHERE namespace.nspname = 'public'
      AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_ISSUANCE_ACL_INVALID';
  END IF;

  IF runtime_oid IS NOT NULL THEN
    SELECT pg_catalog.count(*)::integer INTO unexpected_runtime_function_rows
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
      AND pg_catalog.has_function_privilege(runtime_oid, function.oid, 'EXECUTE')
      AND function.oid NOT IN (
        pg_catalog.to_regprocedure('public.bootstrap_login_candidate_v1(text)'),
        pg_catalog.to_regprocedure('public.bootstrap_session_resolve_v1(text)'),
        pg_catalog.to_regprocedure('public.bootstrap_organization_resolve_v1(text, text)'),
        pg_catalog.to_regprocedure('public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)'),
        pg_catalog.to_regprocedure('public.bootstrap_session_refresh_v1(text)'),
        pg_catalog.to_regprocedure('public.bootstrap_session_invalidate_v1(text)'),
        pg_catalog.to_regprocedure('public.bootstrap_session_revoke_self_others_v1(text)'),
        pg_catalog.to_regprocedure('public.bootstrap_session_revoke_admin_user_org_v1(text, text)'),
        pg_catalog.to_regprocedure('public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)'),
        pg_catalog.to_regprocedure('public.bootstrap_password_reset_candidate_v1(text)'),
        pg_catalog.to_regprocedure('public.bootstrap_password_reset_redeem_v1(text, text)')
      );

    IF unexpected_runtime_function_rows <> 0 OR pg_catalog.has_function_privilege(
      runtime_oid,
      'public.bootstrap_password_reset_issue_anonymous_v1(text, text, text, text, text, integer, text, bytea, bytea, bytea, text)',
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      runtime_oid,
      'public.bootstrap_password_reset_admin_recipient_v1(text, text)',
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      runtime_oid,
      'public.bootstrap_password_reset_issue_admin_single_org_v1(text, text, text, text, text, text, integer, text, bytea, bytea, bytea, text)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BOOTSTRAP_RUNTIME_FUNCTION_MATRIX_INVALID';
    END IF;
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(acl_key ORDER BY acl_key COLLATE pg_catalog."C"),
    ARRAY[]::text[]
  ) INTO expected_runtime_reset_acl
  FROM unit12_runtime_reset_acl_prestate;

  SELECT COALESCE(
    pg_catalog.array_agg(acl_key ORDER BY acl_key COLLATE pg_catalog."C"),
    ARRAY[]::text[]
  ) INTO current_runtime_reset_acl
  FROM (
    SELECT 'table:' || privilege.table_name || ':' || privilege.privilege_type AS acl_key
    FROM information_schema.table_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
      AND privilege.grantee = 'vaultspace_app'
    UNION
    SELECT 'column:' || privilege.table_name || '.' || privilege.column_name || ':' || privilege.privilege_type
    FROM information_schema.column_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
      AND privilege.grantee = 'vaultspace_app'
  ) AS runtime_acl;

  IF current_runtime_reset_acl IS DISTINCT FROM expected_runtime_reset_acl THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_RESET_PRIVILEGES_CHANGED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS catalog_constraint
    WHERE catalog_constraint.conrelid = 'public.password_reset_recoveries'::pg_catalog.regclass
      AND catalog_constraint.conname = 'password_reset_recoveries_envelope_complete'
      AND pg_catalog.pg_get_constraintdef(catalog_constraint.oid) LIKE '%ANY (ARRAY[1, 2])%'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_RECOVERY_CONSTRAINT_FINAL_INVALID';
  END IF;
END
$$;

COMMIT;
