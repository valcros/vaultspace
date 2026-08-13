BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Unit 10 is an inert password-reset redemption foundation. Fail closed on
-- owner, privilege, policy, function, and exact nine-function runtime drift.
DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  unexpected_runtime_function_rows integer;
  current_table_privileges text[];
  current_write_column_privileges text[];
  current_runtime_reset_table_privileges text[];
BEGIN
  SELECT oid
    INTO owner_oid
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
    WHERE roleid = owner_oid
       OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_POSTURE_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  )
    INTO current_table_privileges
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
  )
    INTO current_write_column_privileges
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner'
    AND privilege.privilege_type IN ('INSERT', 'UPDATE');

  IF current_write_column_privileges IS DISTINCT FROM ARRAY[
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
    'sessions.userId:INSERT'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_COLUMN_PRIVILEGES_INVALID';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.bootstrap_password_reset_candidate_v1(text)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.bootstrap_password_reset_redeem_v1(text, text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_FUNCTION_PREEXISTING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'user_organizations'
      AND policy.polname = 'bootstrap_owner_membership_inventory'
      AND policy.polpermissive IS TRUE
      AND policy.polcmd = 'r'
      AND owner_oid = ANY(policy.polroles)
      AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_MEMBERSHIP_POLICY_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  IF runtime_oid IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  )
    INTO current_runtime_reset_table_privileges
  FROM information_schema.table_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
    AND privilege.grantee = 'vaultspace_app';

  IF current_runtime_reset_table_privileges IS DISTINCT FROM ARRAY[
    'password_reset_recoveries:DELETE',
    'password_reset_recoveries:INSERT',
    'password_reset_recoveries:SELECT',
    'password_reset_recoveries:UPDATE',
    'password_reset_tokens:DELETE',
    'password_reset_tokens:INSERT',
    'password_reset_tokens:SELECT',
    'password_reset_tokens:UPDATE'
  ]::text[] OR EXISTS (
    SELECT 1
    FROM information_schema.column_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
      AND privilege.grantee = 'vaultspace_app'
      AND privilege.privilege_type = 'REFERENCES'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_RESET_PRIVILEGE_PRESTATE_INVALID';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_login_candidate_v1(text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_resolve_v1(text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_organization_resolve_v1(text, text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_refresh_v1(text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_invalidate_v1(text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_self_others_v1(text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_admin_user_org_v1(text, text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_user_org_v1(text, text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_user_global_v1(text, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_PREEXISTING_GRANTS_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unexpected_runtime_function_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
    AND pg_catalog.has_function_privilege(runtime_oid, function.oid, 'EXECUTE')
    AND function.oid NOT IN (
      pg_catalog.to_regprocedure('public.bootstrap_login_candidate_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_resolve_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_organization_resolve_v1(text, text)'),
      pg_catalog.to_regprocedure(
        'public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)'
      ),
      pg_catalog.to_regprocedure('public.bootstrap_session_refresh_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_invalidate_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_revoke_self_others_v1(text)'),
      pg_catalog.to_regprocedure(
        'public.bootstrap_session_revoke_admin_user_org_v1(text, text)'
      ),
      pg_catalog.to_regprocedure(
        'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)'
      )
    );

  IF unexpected_runtime_function_rows <> 0 OR pg_catalog.has_table_privilege(
    runtime_oid,
    'public.password_reset_provider_correlations',
    'SELECT, INSERT, UPDATE, DELETE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_PREEXISTING_MATRIX_INVALID';
  END IF;
END
$$;

-- Capture the ordinary role's reviewed reset-table residual exactly. The
-- foundation neither broadens nor contracts this temporary W1-2 residual.
CREATE TEMPORARY TABLE unit10_runtime_reset_acl_prestate (
  acl_key text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO unit10_runtime_reset_acl_prestate (acl_key)
SELECT
  'table:' || privilege.table_name || ':' || privilege.privilege_type
FROM information_schema.table_privileges AS privilege
WHERE privilege.table_schema = 'public'
  AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
  AND privilege.grantee = 'vaultspace_app'
UNION
SELECT
  'column:' || privilege.table_name || '.' || privilege.column_name || ':'
    || privilege.privilege_type
FROM information_schema.column_privileges AS privilege
WHERE privilege.table_schema = 'public'
  AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
  AND privilege.grantee = 'vaultspace_app';

GRANT SELECT (
  "id",
  "userId",
  "token",
  "expiresAt",
  "usedAt",
  "requestId"
) ON public.password_reset_tokens TO vaultspace_bootstrap_owner;

GRANT UPDATE ("usedAt")
ON public.password_reset_tokens TO vaultspace_bootstrap_owner;

GRANT SELECT ("flowId", "wipedAt")
ON public.password_reset_recoveries TO vaultspace_bootstrap_owner;

GRANT UPDATE (
  "cipherVersion",
  "keyId",
  "nonce",
  "ciphertext",
  "authTag",
  "wipedAt",
  "enqueueStatus",
  "updatedAt"
) ON public.password_reset_recoveries TO vaultspace_bootstrap_owner;

GRANT UPDATE ("passwordHash", "updatedAt")
ON public.users TO vaultspace_bootstrap_owner;

-- UPDATE privilege and owner-only policies are required solely so the definer
-- may take deterministic FOR UPDATE locks under FORCE RLS. Organization and
-- membership data are never modified by either Unit 10 function.
GRANT UPDATE ("updatedAt")
ON public.user_organizations TO vaultspace_bootstrap_owner;

GRANT UPDATE ("updatedAt")
ON public.organizations TO vaultspace_bootstrap_owner;

-- These owner-only permissive SELECT policies prevent a caller-controlled
-- app.current_org_id transaction GUC from suppressing account-global reset
-- resolution. Existing restrictive active-row policies remain in force.
CREATE POLICY bootstrap_owner_active_user_password_reset_select
ON public.users
AS PERMISSIVE
FOR SELECT
TO vaultspace_bootstrap_owner
USING ("isActive" IS TRUE);

CREATE POLICY bootstrap_owner_active_organization_password_reset_select
ON public.organizations
AS PERMISSIVE
FOR SELECT
TO vaultspace_bootstrap_owner
USING ("isActive" IS TRUE);

CREATE POLICY bootstrap_owner_active_user_password_reset_update
ON public.users
AS PERMISSIVE
FOR UPDATE
TO vaultspace_bootstrap_owner
USING ("isActive" IS TRUE)
WITH CHECK ("isActive" IS TRUE);

CREATE POLICY bootstrap_owner_membership_password_reset_lock
ON public.user_organizations
AS PERMISSIVE
FOR UPDATE
TO vaultspace_bootstrap_owner
USING (true)
WITH CHECK (true);

CREATE POLICY bootstrap_owner_active_organization_password_reset_lock
ON public.organizations
AS PERMISSIVE
FOR UPDATE
TO vaultspace_bootstrap_owner
USING ("isActive" IS TRUE)
WITH CHECK ("isActive" IS TRUE);

CREATE FUNCTION public.bootstrap_password_reset_candidate_v1(
  input_stored_token text
)
RETURNS TABLE (
  candidate_proven boolean
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH candidate AS MATERIALIZED (
    SELECT reset_token."userId" AS user_id
    FROM public.password_reset_tokens AS reset_token
    INNER JOIN public.users AS candidate_user
      ON candidate_user.id = reset_token."userId"
     AND candidate_user."isActive" IS TRUE
    WHERE input_stored_token IS NOT NULL
      AND (
        input_stored_token OPERATOR(pg_catalog.~) '^prh1:[a-f0-9]{64}$'
        OR input_stored_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
      )
      AND reset_token.token = input_stored_token
      AND reset_token."usedAt" IS NULL
      AND reset_token."expiresAt" > pg_catalog.statement_timestamp()
  ),
  active_scope AS MATERIALIZED (
    SELECT pg_catalog.count(*) AS organization_count
    FROM candidate
    INNER JOIN public.user_organizations AS membership
      ON membership."userId" = candidate.user_id
     AND membership."isActive" IS TRUE
    INNER JOIN public.organizations AS organization
      ON organization.id = membership."organizationId"
     AND organization."isActive" IS TRUE
  )
  SELECT true AS candidate_proven
  FROM active_scope
  WHERE active_scope.organization_count BETWEEN 1 AND 64
$function$;

CREATE FUNCTION public.bootstrap_password_reset_redeem_v1(
  input_stored_token text,
  input_password_hash text
)
RETURNS TABLE (
  authorization_proven boolean,
  flow_id text,
  subject_user_id text,
  subject_email text,
  initiation_request_id text,
  audit_organization_ids text[],
  audit_actor_types text[],
  superseded_flow_ids text[],
  superseded_request_ids text[],
  revoked_session_ids text[]
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
  locked_user_email text;
  locked_flow_id text;
  locked_request_id text;
  locked_membership_count integer := 0;
  affected_rows integer := 0;
  audit_organization_values text[] := ARRAY[]::text[];
  audit_actor_values text[] := ARRAY[]::text[];
  superseded_flow_values text[] := ARRAY[]::text[];
  superseded_request_values text[] := ARRAY[]::text[];
  revoked_session_values text[] := ARRAY[]::text[];
BEGIN
  IF input_stored_token IS NULL
    OR NOT (
      input_stored_token OPERATOR(pg_catalog.~) '^prh1:[a-f0-9]{64}$'
      OR input_stored_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
    )
    OR input_password_hash IS NULL
    OR pg_catalog.char_length(input_password_hash) <> 60
    OR NOT input_password_hash OPERATOR(pg_catalog.~)
      '^[$]2[aby][$]12[$][./A-Za-z0-9]{53}$'
  THEN
    RETURN;
  END IF;

  -- This non-locking lookup derives only the account-global lock key. Every
  -- authorization fact is repeated after the advisory and row locks.
  SELECT reset_token."userId"
    INTO candidate_user_id
  FROM public.password_reset_tokens AS reset_token
  WHERE reset_token.token = input_stored_token
    AND reset_token."usedAt" IS NULL
    AND reset_token."expiresAt" > statement_time;

  IF candidate_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vaultspace/password-reset/user/' || candidate_user_id,
      0
    )
  );

  SELECT candidate_user.id, candidate_user.email
    INTO locked_user_id, locked_user_email
  FROM public.users AS candidate_user
  WHERE candidate_user.id = candidate_user_id
    AND candidate_user."isActive" IS TRUE
  FOR UPDATE OF candidate_user;

  IF locked_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM 1
  FROM public.user_organizations AS membership
  INNER JOIN public.organizations AS organization
    ON organization.id = membership."organizationId"
   AND organization."isActive" IS TRUE
  WHERE membership."userId" = locked_user_id
    AND membership."isActive" IS TRUE
  ORDER BY
    membership."organizationId" COLLATE pg_catalog."C",
    membership.id COLLATE pg_catalog."C"
  FOR UPDATE OF membership, organization;

  GET DIAGNOSTICS locked_membership_count = ROW_COUNT;
  IF locked_membership_count < 1 OR locked_membership_count > 64 THEN
    RETURN;
  END IF;

  SELECT
    pg_catalog.array_agg(
      membership."organizationId"::pg_catalog.text
      ORDER BY membership."organizationId" COLLATE pg_catalog."C"
    ),
    pg_catalog.array_agg(
      CASE
        WHEN membership.role::pg_catalog.text = 'ADMIN' THEN 'ADMIN'::pg_catalog.text
        ELSE 'VIEWER'::pg_catalog.text
      END
      ORDER BY membership."organizationId" COLLATE pg_catalog."C"
    )
    INTO audit_organization_values, audit_actor_values
  FROM public.user_organizations AS membership
  INNER JOIN public.organizations AS organization
    ON organization.id = membership."organizationId"
   AND organization."isActive" IS TRUE
  WHERE membership."userId" = locked_user_id
    AND membership."isActive" IS TRUE;

  SELECT reset_token.id, reset_token."requestId"
    INTO locked_flow_id, locked_request_id
  FROM public.password_reset_tokens AS reset_token
  WHERE reset_token.token = input_stored_token
    AND reset_token."userId" = locked_user_id
    AND reset_token."usedAt" IS NULL
    AND reset_token."expiresAt" > statement_time
  FOR UPDATE OF reset_token;

  IF locked_flow_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM 1
  FROM public.password_reset_tokens AS other_reset_token
  WHERE other_reset_token."userId" = locked_user_id
    AND other_reset_token.id <> locked_flow_id
    AND other_reset_token."usedAt" IS NULL
  ORDER BY other_reset_token.id COLLATE pg_catalog."C"
  FOR UPDATE OF other_reset_token;

  SELECT
    COALESCE(
      pg_catalog.array_agg(
        other_reset_token.id::pg_catalog.text
        ORDER BY other_reset_token.id COLLATE pg_catalog."C"
      ),
      ARRAY[]::text[]
    ),
    COALESCE(
      pg_catalog.array_agg(
        other_reset_token."requestId"::pg_catalog.text
        ORDER BY other_reset_token.id COLLATE pg_catalog."C"
      ),
      ARRAY[]::text[]
    )
    INTO superseded_flow_values, superseded_request_values
  FROM public.password_reset_tokens AS other_reset_token
  WHERE other_reset_token."userId" = locked_user_id
    AND other_reset_token.id <> locked_flow_id
    AND other_reset_token."usedAt" IS NULL;

  PERFORM 1
  FROM public.password_reset_recoveries AS recovery
  WHERE recovery."flowId" = locked_flow_id
     OR recovery."flowId" = ANY(superseded_flow_values)
  ORDER BY recovery."flowId" COLLATE pg_catalog."C"
  FOR UPDATE OF recovery;

  UPDATE public.password_reset_tokens AS reset_token
  SET "usedAt" = statement_time
  WHERE reset_token.id = locked_flow_id
    AND reset_token."usedAt" IS NULL
    AND reset_token."expiresAt" > statement_time;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RETURN;
  END IF;

  UPDATE public.password_reset_recoveries AS recovery
  SET
    "cipherVersion" = NULL,
    "keyId" = NULL,
    nonce = NULL,
    ciphertext = NULL,
    "authTag" = NULL,
    "wipedAt" = statement_time,
    "enqueueStatus" = 'REDEEMED',
    "updatedAt" = statement_time
  WHERE recovery."flowId" = locked_flow_id
    AND recovery."wipedAt" IS NULL;

  UPDATE public.users AS candidate_user
  SET
    "passwordHash" = input_password_hash,
    "updatedAt" = statement_time
  WHERE candidate_user.id = locked_user_id
    AND candidate_user."isActive" IS TRUE;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_USER_UPDATE_LOST';
  END IF;

  UPDATE public.password_reset_tokens AS reset_token
  SET "usedAt" = statement_time
  WHERE reset_token.id = ANY(superseded_flow_values)
    AND reset_token."userId" = locked_user_id
    AND reset_token."usedAt" IS NULL;

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

  SELECT COALESCE(
    pg_catalog.array_agg(
      revoked_session.session_id::pg_catalog.text
      ORDER BY revoked_session.session_id COLLATE pg_catalog."C"
    ),
    ARRAY[]::text[]
  )
    INTO revoked_session_values
  FROM public.bootstrap_session_revoke_user_global_v1(
    locked_user_id::pg_catalog.text,
    NULL::pg_catalog.text
  ) AS revoked_session;

  authorization_proven := true;
  flow_id := locked_flow_id;
  subject_user_id := locked_user_id;
  subject_email := locked_user_email;
  initiation_request_id := locked_request_id;
  audit_organization_ids := audit_organization_values;
  audit_actor_types := audit_actor_values;
  superseded_flow_ids := superseded_flow_values;
  superseded_request_ids := superseded_request_values;
  revoked_session_ids := revoked_session_values;
  RETURN NEXT;
END
$function$;

COMMENT ON FUNCTION public.bootstrap_password_reset_candidate_v1(text) IS
  'vaultspace-contract:w1-2-password-reset-candidate-v1';

COMMENT ON FUNCTION public.bootstrap_password_reset_redeem_v1(text, text) IS
  'vaultspace-contract:w1-2-password-reset-redeem-v1';

REVOKE ALL ON FUNCTION public.bootstrap_password_reset_candidate_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_password_reset_redeem_v1(text, text) FROM PUBLIC;

DO $$
DECLARE
  temporary_membership boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_app'
  ) THEN
    REVOKE ALL ON FUNCTION public.bootstrap_password_reset_candidate_v1(text)
      FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_password_reset_redeem_v1(text, text)
      FROM vaultspace_app;
  END IF;

  GRANT CREATE ON SCHEMA public TO vaultspace_bootstrap_owner;

  IF NOT pg_catalog.pg_has_role(
    CURRENT_USER,
    'vaultspace_bootstrap_owner',
    'MEMBER'
  ) THEN
    EXECUTE pg_catalog.format(
      'GRANT vaultspace_bootstrap_owner TO %I',
      CURRENT_USER
    );
    temporary_membership := true;
  END IF;

  ALTER FUNCTION public.bootstrap_password_reset_candidate_v1(text)
    OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_password_reset_redeem_v1(text, text)
    OWNER TO vaultspace_bootstrap_owner;

  IF temporary_membership THEN
    EXECUTE pg_catalog.format(
      'REVOKE vaultspace_bootstrap_owner FROM %I',
      CURRENT_USER
    );
  END IF;

  REVOKE CREATE ON SCHEMA public FROM vaultspace_bootstrap_owner;
END
$$;

-- Final exact catalog proof. Source MD5 values are patched from PostgreSQL's
-- canonical prosrc after the reviewed function bodies are finalized.
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
  current_runtime_reset_acl text[];
  expected_runtime_reset_acl text[];
BEGIN
  SELECT oid
    INTO owner_oid
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
    WHERE roleid = owner_oid
       OR member = owner_oid
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
  )
    INTO current_table_privileges
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
  )
    INTO current_write_column_privileges
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
      MESSAGE = 'BOOTSTRAP_OWNER_COLUMN_PRIVILEGES_FINAL_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || '.' || privilege.column_name
      ORDER BY privilege.table_name, privilege.column_name
    ),
    ARRAY[]::text[]
  )
    INTO current_reset_select_column_privileges
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
      MESSAGE = 'BOOTSTRAP_OWNER_RESET_SELECT_PRIVILEGES_FINAL_INVALID';
  END IF;

  IF pg_catalog.has_table_privilege(owner_oid, 'public.users', 'INSERT, UPDATE, DELETE')
    OR pg_catalog.has_table_privilege(
      owner_oid,
      'public.password_reset_tokens',
      'INSERT, UPDATE, DELETE'
    )
    OR pg_catalog.has_table_privilege(
      owner_oid,
      'public.password_reset_recoveries',
      'INSERT, UPDATE, DELETE'
    )
    OR pg_catalog.has_table_privilege(owner_oid, 'public.sessions', 'INSERT, UPDATE, DELETE')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_TABLE_WRITE_FINAL_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'users'
      AND policy.polname = 'bootstrap_owner_active_user_password_reset_select'
      AND policy.polpermissive IS TRUE
      AND policy.polcmd = 'r'
      AND owner_oid = ANY(policy.polroles)
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'organizations'
      AND policy.polname = 'bootstrap_owner_active_organization_password_reset_select'
      AND policy.polpermissive IS TRUE
      AND policy.polcmd = 'r'
      AND owner_oid = ANY(policy.polroles)
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'users'
      AND policy.polname = 'bootstrap_owner_active_user_password_reset_update'
      AND policy.polpermissive IS TRUE
      AND policy.polcmd = 'w'
      AND owner_oid = ANY(policy.polroles)
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'user_organizations'
      AND policy.polname = 'bootstrap_owner_membership_password_reset_lock'
      AND policy.polpermissive IS TRUE
      AND policy.polcmd = 'w'
      AND owner_oid = ANY(policy.polroles)
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'organizations'
      AND policy.polname = 'bootstrap_owner_active_organization_password_reset_lock'
      AND policy.polpermissive IS TRUE
      AND policy.polcmd = 'w'
      AND owner_oid = ANY(policy.polroles)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_PASSWORD_RESET_POLICY_FINAL_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_function_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  INNER JOIN pg_catalog.pg_roles AS owner
    ON owner.oid = function.proowner
  INNER JOIN pg_catalog.pg_language AS language
    ON language.oid = function.prolang
  INNER JOIN (
    VALUES
      (
        'bootstrap_password_reset_candidate_v1',
        'input_stored_token text',
        'sql',
        's'::"char",
        'fb2338b2271dcbe38ddb05f4b7a55e65',
        'vaultspace-contract:w1-2-password-reset-candidate-v1',
        'TABLE(candidate_proven boolean)'
      ),
      (
        'bootstrap_password_reset_redeem_v1',
        'input_stored_token text, input_password_hash text',
        'plpgsql',
        'v'::"char",
        'be86d46853493dc7dba68cfba0b68c4b',
        'vaultspace-contract:w1-2-password-reset-redeem-v1',
        'TABLE(authorization_proven boolean, flow_id text, subject_user_id text, subject_email text, initiation_request_id text, audit_organization_ids text[], audit_actor_types text[], superseded_flow_ids text[], superseded_request_ids text[], revoked_session_ids text[])'
      )
  ) AS expected(
    function_name,
    identity_arguments,
    language_name,
    volatility,
    source_md5,
    contract_comment,
    function_result
  )
    ON expected.function_name = function.proname
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      'bootstrap_password_reset_candidate_v1',
      'bootstrap_password_reset_redeem_v1'
    )
    AND (
      owner.rolname <> 'vaultspace_bootstrap_owner'
      OR pg_catalog.pg_get_function_identity_arguments(function.oid)
        <> expected.identity_arguments
      OR language.lanname <> expected.language_name
      OR function.prosecdef IS DISTINCT FROM true
      OR function.provolatile <> expected.volatility
      OR function.proparallel <> 'u'
      OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR pg_catalog.md5(function.prosrc) <> expected.source_md5
      OR pg_catalog.obj_description(function.oid, 'pg_proc') <> expected.contract_comment
      OR pg_catalog.pg_get_function_result(function.oid) <> expected.function_result
    );

  IF invalid_function_rows <> 0 OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname IN (
        'bootstrap_password_reset_candidate_v1',
        'bootstrap_password_reset_redeem_v1'
      )
  ) <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_FUNCTION_POSTURE_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unexpected_acl_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
  ) AS acl
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      'bootstrap_password_reset_candidate_v1',
      'bootstrap_password_reset_redeem_v1'
    )
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> owner_oid;

  IF unexpected_acl_rows <> 0 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
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
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_ACL_INVALID';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(acl_key ORDER BY acl_key), ARRAY[]::text[])
    INTO expected_runtime_reset_acl
  FROM unit10_runtime_reset_acl_prestate;

  SELECT COALESCE(pg_catalog.array_agg(acl_key ORDER BY acl_key), ARRAY[]::text[])
    INTO current_runtime_reset_acl
  FROM (
    SELECT
      'table:' || privilege.table_name || ':' || privilege.privilege_type AS acl_key
    FROM information_schema.table_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name IN ('password_reset_tokens', 'password_reset_recoveries')
      AND privilege.grantee = 'vaultspace_app'
    UNION
    SELECT
      'column:' || privilege.table_name || '.' || privilege.column_name || ':'
        || privilege.privilege_type
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

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  IF runtime_oid IS NULL THEN
    RETURN;
  END IF;

  IF pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_password_reset_candidate_v1(text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_password_reset_redeem_v1(text, text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_user_org_v1(text, text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_user_global_v1(text, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_RUNTIME_GRANTS_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unexpected_runtime_function_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
    AND pg_catalog.has_function_privilege(runtime_oid, function.oid, 'EXECUTE')
    AND function.oid NOT IN (
      pg_catalog.to_regprocedure('public.bootstrap_login_candidate_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_resolve_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_organization_resolve_v1(text, text)'),
      pg_catalog.to_regprocedure(
        'public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)'
      ),
      pg_catalog.to_regprocedure('public.bootstrap_session_refresh_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_invalidate_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_revoke_self_others_v1(text)'),
      pg_catalog.to_regprocedure(
        'public.bootstrap_session_revoke_admin_user_org_v1(text, text)'
      ),
      pg_catalog.to_regprocedure(
        'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)'
      )
    );

  IF unexpected_runtime_function_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_FUNCTION_MATRIX_INVALID';
  END IF;
END
$$;

COMMIT;
