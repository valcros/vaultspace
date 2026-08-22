-- The v2 issuer may create an MFA-assured tenant session only by consuming a
-- matching, unexpired, single-use server-side challenge in the same statement.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

GRANT USAGE ON TYPE public."SessionAuthenticationAssurance" TO vaultspace_mfa_auth_owner;
GRANT INSERT (
  "id", "createdAt", "updatedAt", "userId", "organizationId", "token",
  "expiresAt", "lastActiveAt", "mfaVerifiedAt", "authenticationAssurance",
  "ipAddress", "userAgent", "isActive"
) ON public.sessions TO vaultspace_mfa_auth_owner;
GRANT SELECT (
  "id", "createdAt", "expiresAt", "mfaVerifiedAt", "authenticationAssurance"
) ON public.sessions TO vaultspace_mfa_auth_owner;

CREATE FUNCTION public.bootstrap_session_create_mfa_v2(
  input_user_id text,
  input_organization_id text,
  input_challenge_token text,
  input_session_token text,
  input_expires_at timestamptz,
  input_ip_address text,
  input_user_agent text
)
RETURNS TABLE (
  session_id text,
  session_created_at timestamptz,
  session_expires_at timestamptz,
  session_mfa_verified_at timestamptz,
  session_authentication_assurance text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  statement_time timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF input_user_id IS NULL OR pg_catalog.char_length(input_user_id) NOT BETWEEN 1 AND 255
    OR input_organization_id IS NULL OR pg_catalog.char_length(input_organization_id) NOT BETWEEN 1 AND 255
    OR input_challenge_token IS NULL OR input_challenge_token OPERATOR(pg_catalog.!~) '^[A-Za-z0-9_-]{43}$'
    OR input_session_token IS NULL OR input_session_token OPERATOR(pg_catalog.!~) '^[A-Za-z0-9_-]{43}$'
    OR input_expires_at IS NULL OR input_expires_at <= statement_time
    OR input_expires_at > statement_time + pg_catalog.make_interval(days => 30)
    OR (input_ip_address IS NOT NULL AND pg_catalog.char_length(input_ip_address) > 50)
    OR (input_user_agent IS NOT NULL AND pg_catalog.char_length(input_user_agent) > 4096)
  THEN RETURN; END IF;

  RETURN QUERY
  WITH eligible_challenge AS (
    SELECT challenge.id
    FROM public.two_factor_login_challenges AS challenge
    WHERE challenge."tokenHash" = pg_catalog.encode(
      public.digest(input_challenge_token, 'sha256'), 'hex'
    )
      AND challenge."userId" = input_user_id
      AND challenge."organizationId" = input_organization_id
      AND challenge.purpose = 'TENANT_LOGIN'::public."TwoFactorLoginChallengePurpose"
      AND challenge."consumedAt" IS NULL
      AND challenge."expiresAt" > statement_time
    FOR UPDATE
  ), created_session AS (
    INSERT INTO public.sessions (
      "id", "createdAt", "updatedAt", "userId", "organizationId", "token",
      "expiresAt", "lastActiveAt", "mfaVerifiedAt", "authenticationAssurance",
      "ipAddress", "userAgent", "isActive"
    )
    SELECT pg_catalog.gen_random_uuid()::pg_catalog.text, statement_time, statement_time,
      user_row.id, organization.id, input_session_token, input_expires_at, statement_time,
      statement_time, 'MFA'::public."SessionAuthenticationAssurance",
      input_ip_address, input_user_agent, true
    FROM eligible_challenge
    INNER JOIN public.users AS user_row ON user_row.id = input_user_id AND user_row."isActive" IS TRUE
    INNER JOIN public.user_organizations AS membership
      ON membership."userId" = user_row.id
     AND membership."organizationId" = input_organization_id
     AND membership."isActive" IS TRUE
    INNER JOIN public.organizations AS organization
      ON organization.id = membership."organizationId" AND organization."isActive" IS TRUE
    RETURNING id, "createdAt", "expiresAt", "mfaVerifiedAt", "authenticationAssurance"
  ), consumed_challenge AS (
    UPDATE public.two_factor_login_challenges AS challenge
    SET "consumedAt" = statement_time
    FROM eligible_challenge
    WHERE challenge.id = eligible_challenge.id
      AND EXISTS (SELECT 1 FROM created_session)
    RETURNING challenge.id
  )
  SELECT session.id::pg_catalog.text, session."createdAt"::timestamptz,
    session."expiresAt"::timestamptz, session."mfaVerifiedAt"::timestamptz,
    session."authenticationAssurance"::pg_catalog.text
  FROM created_session AS session
  CROSS JOIN consumed_challenge;
END
$function$;

COMMENT ON FUNCTION public.bootstrap_session_create_mfa_v2(
  text, text, text, text, timestamptz, text, text
) IS 'vaultspace-contract:challenge-bound-mfa-session-create-v2';

REVOKE ALL ON FUNCTION public.bootstrap_session_create_mfa_v2(
  text, text, text, text, timestamptz, text, text
) FROM PUBLIC;

DO $$
DECLARE temporary_membership boolean := false;
BEGIN
  GRANT CREATE ON SCHEMA public TO vaultspace_mfa_auth_owner;
  IF NOT pg_catalog.pg_has_role(CURRENT_USER, 'vaultspace_mfa_auth_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT vaultspace_mfa_auth_owner TO %I', CURRENT_USER);
    temporary_membership := true;
  END IF;
  ALTER FUNCTION public.bootstrap_session_create_mfa_v2(
    text, text, text, text, timestamptz, text, text
  ) OWNER TO vaultspace_mfa_auth_owner;
  IF temporary_membership THEN
    EXECUTE pg_catalog.format('REVOKE vaultspace_mfa_auth_owner FROM %I', CURRENT_USER);
  END IF;
  REVOKE CREATE ON SCHEMA public FROM vaultspace_mfa_auth_owner;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    GRANT EXECUTE ON FUNCTION public.bootstrap_session_create_mfa_v2(
      text, text, text, text, timestamptz, text, text
    ) TO vaultspace_app;
  END IF;
END $$;

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  v1_oid oid;
  v2_oid oid;
  issue_oid oid;
  resolve_oid oid;
  owner_table_privileges text[];
  owner_session_column_privileges text[];
  invalid_function_count integer;
  unexpected_owned_function_count integer;
  unexpected_execute_acl_count integer;
BEGIN
  SELECT oid INTO owner_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_mfa_auth_owner'
    AND rolcanlogin IS FALSE
    AND rolinherit IS FALSE
    AND rolsuper IS FALSE
    AND rolbypassrls IS FALSE
    AND rolcreatedb IS FALSE
    AND rolcreaterole IS FALSE
    AND rolreplication IS FALSE;
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app';
  v1_oid := pg_catalog.to_regprocedure(
    'public.bootstrap_session_create_mfa_v1(text, text, text, timestamp with time zone, text, text)'
  );
  v2_oid := pg_catalog.to_regprocedure(
    'public.bootstrap_session_create_mfa_v2(text, text, text, text, timestamp with time zone, text, text)'
  );
  issue_oid := pg_catalog.to_regprocedure(
    'public.bootstrap_two_factor_challenge_issue_v1(text, text, text, timestamp with time zone)'
  );
  resolve_oid := pg_catalog.to_regprocedure('public.bootstrap_two_factor_challenge_resolve_v1(text)');

  IF owner_oid IS NULL OR v1_oid IS NULL OR v2_oid IS NULL OR issue_oid IS NULL OR resolve_oid IS NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid = owner_oid OR member = owner_oid)
    OR (runtime_oid IS NOT NULL AND pg_catalog.pg_has_role(runtime_oid, owner_oid, 'MEMBER'))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_AUTH_OWNER_POST_MIGRATION_POSTURE_INVALID';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(
    privilege.table_name || ':' || privilege.privilege_type
    ORDER BY privilege.table_name, privilege.privilege_type
  ), ARRAY[]::text[])
  INTO owner_table_privileges
  FROM information_schema.table_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_mfa_auth_owner';
  IF owner_table_privileges IS DISTINCT FROM ARRAY[
    'organizations:SELECT',
    'two_factor_login_challenges:INSERT',
    'two_factor_login_challenges:SELECT',
    'two_factor_login_challenges:UPDATE',
    'user_organizations:SELECT',
    'users:SELECT'
  ]::text[] THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_AUTH_OWNER_TABLE_PRIVILEGES_INVALID';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(
    privilege.column_name || ':' || privilege.privilege_type
    ORDER BY privilege.column_name, privilege.privilege_type
  ), ARRAY[]::text[])
  INTO owner_session_column_privileges
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.table_name = 'sessions'
    AND privilege.grantee = 'vaultspace_mfa_auth_owner'
    AND privilege.privilege_type IN ('INSERT', 'SELECT', 'UPDATE', 'REFERENCES');
  IF owner_session_column_privileges IS DISTINCT FROM ARRAY[
    'authenticationAssurance:INSERT',
    'authenticationAssurance:SELECT',
    'createdAt:INSERT',
    'createdAt:SELECT',
    'expiresAt:INSERT',
    'expiresAt:SELECT',
    'id:INSERT',
    'id:SELECT',
    'ipAddress:INSERT',
    'isActive:INSERT',
    'lastActiveAt:INSERT',
    'mfaVerifiedAt:INSERT',
    'mfaVerifiedAt:SELECT',
    'organizationId:INSERT',
    'token:INSERT',
    'updatedAt:INSERT',
    'userAgent:INSERT',
    'userId:INSERT'
  ]::text[] THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_AUTH_OWNER_SESSION_COLUMN_PRIVILEGES_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO invalid_function_count
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_language AS language ON language.oid = function.prolang
  WHERE function.oid IN (issue_oid, resolve_oid, v2_oid)
    AND (
      function.proowner <> owner_oid
      OR function.prosecdef IS DISTINCT FROM true
      OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR (function.oid = resolve_oid AND (language.lanname <> 'sql' OR function.provolatile <> 's' OR function.proparallel <> 's'))
      OR (function.oid <> resolve_oid AND (language.lanname <> 'plpgsql' OR function.provolatile <> 'v' OR function.proparallel <> 'u'))
    );
  IF invalid_function_count <> 0
    OR pg_catalog.obj_description(v2_oid, 'pg_proc') <> 'vaultspace-contract:challenge-bound-mfa-session-create-v2'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_AUTH_FUNCTION_POSTURE_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO unexpected_owned_function_count
  FROM pg_catalog.pg_proc
  WHERE proowner = owner_oid AND oid NOT IN (issue_oid, resolve_oid, v2_oid);
  IF unexpected_owned_function_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_AUTH_OWNER_UNEXPECTED_FUNCTION_OWNERSHIP';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO unexpected_execute_acl_count
  FROM pg_catalog.pg_proc AS function
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
  ) AS acl
  WHERE function.oid IN (issue_oid, resolve_oid, v2_oid, v1_oid)
    AND acl.privilege_type = 'EXECUTE'
    AND (
      acl.grantee = 0
      OR (function.oid = v1_oid AND acl.grantee <> function.proowner)
      OR (function.oid <> v1_oid AND acl.grantee NOT IN (function.proowner, runtime_oid))
    );
  IF unexpected_execute_acl_count <> 0
    OR (runtime_oid IS NOT NULL AND (
      pg_catalog.has_function_privilege(runtime_oid, v1_oid, 'EXECUTE')
      OR NOT pg_catalog.has_function_privilege(runtime_oid, issue_oid, 'EXECUTE')
      OR NOT pg_catalog.has_function_privilege(runtime_oid, resolve_oid, 'EXECUTE')
      OR NOT pg_catalog.has_function_privilege(runtime_oid, v2_oid, 'EXECUTE')
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_AUTH_FUNCTION_ACL_INVALID';
  END IF;
END
$$;

COMMIT;
