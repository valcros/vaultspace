-- Creates only a narrowly-scoped MFA session issuance capability. The caller
-- cannot supply the MFA timestamp or assurance value.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

GRANT USAGE ON TYPE public."SessionAuthenticationAssurance" TO vaultspace_bootstrap_owner;
GRANT INSERT ("mfaVerifiedAt", "authenticationAssurance")
  ON public.sessions TO vaultspace_bootstrap_owner;

-- The normal runtime role retains legacy table-level session write grants.
-- Those grants must never be sufficient to fabricate or rewrite MFA
-- assurance. SECURITY DEFINER MFA issuance runs as the reviewed owner.
CREATE FUNCTION public.bootstrap_session_mfa_assurance_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF CURRENT_USER NOT IN ('vaultspace_bootstrap_owner', 'vaultspace_mfa_auth_owner')
      AND (NEW."mfaVerifiedAt" IS NOT NULL OR NEW."authenticationAssurance" <> 'PASSWORD')
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'MFA_SESSION_ASSURANCE_WRITE_DENIED';
    END IF;
  ELSIF CURRENT_USER NOT IN ('vaultspace_bootstrap_owner', 'vaultspace_mfa_auth_owner') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'MFA_SESSION_ASSURANCE_WRITE_DENIED';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER sessions_mfa_assurance_guard
BEFORE INSERT OR UPDATE OF "mfaVerifiedAt", "authenticationAssurance" ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.bootstrap_session_mfa_assurance_guard_v1();

REVOKE ALL ON FUNCTION public.bootstrap_session_mfa_assurance_guard_v1() FROM PUBLIC;

CREATE FUNCTION public.bootstrap_session_create_mfa_v1(
  input_user_id text,
  input_organization_id text,
  input_token text,
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
  generated_session_id text := pg_catalog.gen_random_uuid()::pg_catalog.text;
BEGIN
  IF input_user_id IS NULL
    OR pg_catalog.char_length(input_user_id) < 1
    OR pg_catalog.char_length(input_user_id) > 255
    OR input_organization_id IS NULL
    OR pg_catalog.char_length(input_organization_id) < 1
    OR pg_catalog.char_length(input_organization_id) > 255
    OR input_token IS NULL
    OR pg_catalog.char_length(input_token) <> 43
    OR input_token OPERATOR(pg_catalog.!~) '^[A-Za-z0-9_-]{43}$'
    OR input_expires_at IS NULL
    OR input_expires_at <= statement_time
    OR input_expires_at > statement_time + pg_catalog.make_interval(days => 30)
    OR (input_ip_address IS NOT NULL AND pg_catalog.char_length(input_ip_address) > 50)
    OR (input_user_agent IS NOT NULL AND pg_catalog.char_length(input_user_agent) > 4096)
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.sessions (
    "id", "createdAt", "updatedAt", "userId", "organizationId", "token",
    "expiresAt", "lastActiveAt", "mfaVerifiedAt", "authenticationAssurance",
    "ipAddress", "userAgent", "isActive"
  )
  SELECT
    generated_session_id, statement_time, statement_time, resolved_user.id,
    organization.id, input_token, input_expires_at, statement_time,
    statement_time, 'MFA'::public."SessionAuthenticationAssurance",
    input_ip_address, input_user_agent, true
  FROM public.users AS resolved_user
  INNER JOIN public.user_organizations AS membership
    ON membership."userId" = resolved_user.id
   AND membership."organizationId" = input_organization_id
   AND membership."isActive" IS TRUE
  INNER JOIN public.organizations AS organization
    ON organization.id = membership."organizationId"
   AND organization."isActive" IS TRUE
  WHERE resolved_user.id = input_user_id
    AND resolved_user."isActive" IS TRUE
  ON CONFLICT DO NOTHING
  RETURNING
    sessions.id::pg_catalog.text,
    sessions."createdAt"::timestamptz,
    sessions."expiresAt"::timestamptz,
    sessions."mfaVerifiedAt"::timestamptz,
    sessions."authenticationAssurance"::pg_catalog.text;
END
$function$;

COMMENT ON FUNCTION public.bootstrap_session_create_mfa_v1(
  text, text, text, timestamptz, text, text
) IS 'vaultspace-contract:w1-2-session-create-mfa-v1';

REVOKE ALL ON FUNCTION public.bootstrap_session_create_mfa_v1(
  text, text, text, timestamptz, text, text
) FROM PUBLIC;

DO $$
DECLARE
  temporary_membership boolean := false;
BEGIN
  GRANT CREATE ON SCHEMA public TO vaultspace_bootstrap_owner;
  IF NOT pg_catalog.pg_has_role(CURRENT_USER, 'vaultspace_bootstrap_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT vaultspace_bootstrap_owner TO %I', CURRENT_USER);
    temporary_membership := true;
  END IF;

  ALTER FUNCTION public.bootstrap_session_create_mfa_v1(
    text, text, text, timestamptz, text, text
  ) OWNER TO vaultspace_bootstrap_owner;

  IF temporary_membership THEN
    EXECUTE pg_catalog.format('REVOKE vaultspace_bootstrap_owner FROM %I', CURRENT_USER);
  END IF;
  REVOKE CREATE ON SCHEMA public FROM vaultspace_bootstrap_owner;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    -- v1 cannot prove a completed MFA challenge. It is retained only for
    -- migration compatibility and must be unreachable by the runtime role.
    REVOKE EXECUTE ON FUNCTION public.bootstrap_session_create_mfa_v1(
      text, text, text, timestamptz, text, text
    ) FROM vaultspace_app;
  END IF;
END
$$;

DO $$
DECLARE
  owner_oid oid;
  function_oid oid;
  runtime_oid oid;
  owner_table_privileges text[];
  owner_write_column_privileges text[];
  unexpected_sequence_privileges integer;
  invalid_function_rows integer;
  unexpected_acl_count integer;
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
  SELECT oid INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';
  function_oid := pg_catalog.to_regprocedure(
    'public.bootstrap_session_create_mfa_v1(text, text, text, timestamp with time zone, text, text)'
  );

  IF owner_oid IS NULL OR function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = owner_oid OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_SESSION_OWNER_POSTURE_INVALID';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(
    privilege.table_name || ':' || privilege.privilege_type
    ORDER BY privilege.table_name, privilege.privilege_type
  ), ARRAY[]::text[])
  INTO owner_table_privileges
  FROM information_schema.table_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner';
  IF owner_table_privileges IS DISTINCT FROM ARRAY[
    'organizations:SELECT', 'sessions:SELECT', 'user_organizations:SELECT', 'users:SELECT'
  ]::text[] THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_SESSION_OWNER_TABLE_PRIVILEGES_INVALID';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(
    privilege.table_name || '.' || privilege.column_name || ':' || privilege.privilege_type
    ORDER BY privilege.table_name, privilege.column_name, privilege.privilege_type
  ), ARRAY[]::text[])
  INTO owner_write_column_privileges
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner'
    AND privilege.privilege_type IN ('INSERT', 'UPDATE');
  IF owner_write_column_privileges IS DISTINCT FROM ARRAY[
    'sessions.authenticationAssurance:INSERT',
    'sessions.createdAt:INSERT',
    'sessions.expiresAt:INSERT',
    'sessions.expiresAt:UPDATE',
    'sessions.id:INSERT',
    'sessions.ipAddress:INSERT',
    'sessions.isActive:INSERT',
    'sessions.isActive:UPDATE',
    'sessions.lastActiveAt:INSERT',
    'sessions.lastActiveAt:UPDATE',
    'sessions.mfaVerifiedAt:INSERT',
    'sessions.organizationId:INSERT',
    'sessions.token:INSERT',
    'sessions.updatedAt:INSERT',
    'sessions.updatedAt:UPDATE',
    'sessions.userAgent:INSERT',
    'sessions.userId:INSERT'
  ]::text[] THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_SESSION_OWNER_COLUMN_PRIVILEGES_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO unexpected_sequence_privileges
  FROM pg_catalog.pg_class AS relation
  INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE relation.relkind = 'S'
    AND namespace.nspname = 'public'
    AND pg_catalog.has_sequence_privilege(
      'vaultspace_bootstrap_owner',
      pg_catalog.format('%I.%I', namespace.nspname, relation.relname),
      'USAGE,SELECT,UPDATE'
    );
  IF unexpected_sequence_privileges <> 0
    OR NOT pg_catalog.has_schema_privilege(owner_oid, 'public', 'USAGE')
    OR pg_catalog.has_schema_privilege(owner_oid, 'public', 'CREATE')
    OR NOT pg_catalog.has_type_privilege(
      owner_oid, 'public."SessionAuthenticationAssurance"', 'USAGE'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_SESSION_OWNER_AUXILIARY_PRIVILEGES_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO invalid_function_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_roles AS owner ON owner.oid = function.proowner
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function.prolang
  WHERE function.oid = function_oid
    AND (
      owner.oid <> owner_oid
      OR language.lanname <> 'plpgsql'
      OR function.prosecdef IS DISTINCT FROM true
      OR function.provolatile <> 'v'
      OR function.proparallel <> 'u'
      OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR pg_catalog.md5(function.prosrc) <> '106b2da7e362a164ce4769d32ca95707'
      OR pg_catalog.obj_description(function.oid, 'pg_proc')
        <> 'vaultspace-contract:w1-2-session-create-mfa-v1'
    );
  IF invalid_function_rows <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_SESSION_FUNCTION_POSTURE_INVALID';
  END IF;

  SELECT pg_catalog.count(*) INTO unexpected_acl_count
  FROM pg_catalog.pg_proc AS function
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
  ) AS acl
  WHERE function.oid = function_oid
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee NOT IN (
      function.proowner,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app')
    );
  IF unexpected_acl_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_SESSION_FUNCTION_ACL_INVALID';
  END IF;

  IF runtime_oid IS NOT NULL AND (
    pg_catalog.has_function_privilege(runtime_oid, function_oid, 'EXECUTE')
    OR pg_catalog.pg_has_role(runtime_oid, owner_oid, 'MEMBER')
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
      INNER JOIN pg_catalog.pg_proc AS trigger_function ON trigger_function.oid = trigger.tgfoid
      WHERE trigger.tgrelid = 'public.sessions'::pg_catalog.regclass
        AND trigger.tgname = 'sessions_mfa_assurance_guard'
        AND trigger.tgenabled = 'O'
        AND trigger_function.proname = 'bootstrap_session_mfa_assurance_guard_v1'
        AND trigger_function.prosecdef IS FALSE
        AND trigger_function.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_SESSION_RUNTIME_BOUNDARY_INVALID';
  END IF;
END
$$;

COMMIT;
