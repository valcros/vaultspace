BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  runtime_reaches_owner boolean := false;
  current_table_privileges text[];
  current_write_column_privileges text[];
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

  IF owner_oid IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_POSTURE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE roleid = owner_oid
       OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_MEMBERSHIP_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  IF runtime_oid IS NOT NULL THEN
    WITH RECURSIVE membership_closure(roleid) AS (
      SELECT membership.roleid
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.member = runtime_oid

      UNION

      SELECT membership.roleid
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN membership_closure AS inherited
        ON inherited.roleid = membership.member
    )
    SELECT COALESCE(
      pg_catalog.bool_or(membership_closure.roleid = owner_oid),
      false
    )
      INTO runtime_reaches_owner
    FROM membership_closure;
  END IF;

  IF runtime_reaches_owner THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_RUNTIME_REACHABILITY_INVALID';
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
      MESSAGE = 'BOOTSTRAP_OWNER_PREEXISTING_TABLE_PRIVILEGES_INVALID';
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

  IF current_write_column_privileges IS DISTINCT FROM ARRAY[]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_PREEXISTING_SESSION_WRITE_PRIVILEGES_INVALID';
  END IF;
END
$$;

GRANT INSERT (
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "organizationId",
  "token",
  "expiresAt",
  "lastActiveAt",
  "ipAddress",
  "userAgent",
  "isActive"
) ON public.sessions TO vaultspace_bootstrap_owner;

GRANT UPDATE (
  "updatedAt",
  "expiresAt",
  "lastActiveAt",
  "isActive"
) ON public.sessions TO vaultspace_bootstrap_owner;

CREATE FUNCTION public.bootstrap_session_create_v1(
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
  session_expires_at timestamptz
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
    "id",
    "createdAt",
    "updatedAt",
    "userId",
    "organizationId",
    "token",
    "expiresAt",
    "lastActiveAt",
    "ipAddress",
    "userAgent",
    "isActive"
  )
  SELECT
    generated_session_id,
    statement_time,
    statement_time,
    resolved_user.id,
    organization.id,
    input_token,
    input_expires_at,
    statement_time,
    input_ip_address,
    input_user_agent,
    true
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
    sessions."expiresAt"::timestamptz;
END
$function$;

CREATE FUNCTION public.bootstrap_session_refresh_v1(input_token text)
RETURNS TABLE (
  session_id text,
  session_expires_at timestamptz
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH eligible_session AS (
    SELECT
      application_session.id,
      pg_catalog.statement_timestamp() + pg_catalog.make_interval(hours => 24) AS next_expiry
    FROM public.sessions AS application_session
    INNER JOIN public.users AS resolved_user
      ON resolved_user.id = application_session."userId"
     AND resolved_user."isActive" IS TRUE
    INNER JOIN public.user_organizations AS membership
      ON membership."userId" = application_session."userId"
     AND membership."organizationId" = application_session."organizationId"
     AND membership."isActive" IS TRUE
    INNER JOIN public.organizations AS organization
      ON organization.id = application_session."organizationId"
     AND organization."isActive" IS TRUE
    WHERE input_token IS NOT NULL
      AND pg_catalog.char_length(input_token) = 43
      AND input_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
      AND application_session.token = input_token
      AND application_session."isActive" IS TRUE
      AND application_session."organizationId" IS NOT NULL
      AND application_session."expiresAt" > pg_catalog.statement_timestamp()
      AND application_session."createdAt" + pg_catalog.make_interval(days => 7)
        > pg_catalog.statement_timestamp()
      AND application_session."lastActiveAt" <=
        pg_catalog.statement_timestamp() - pg_catalog.make_interval(mins => 5)
    FOR UPDATE OF application_session
  ),
  refreshed_session AS (
    UPDATE public.sessions AS application_session
    SET
      "updatedAt" = pg_catalog.statement_timestamp(),
      "lastActiveAt" = pg_catalog.statement_timestamp(),
      "expiresAt" = eligible_session.next_expiry
    FROM eligible_session
    WHERE application_session.id = eligible_session.id
    RETURNING
      application_session.id,
      application_session."expiresAt"
  )
  SELECT
    refreshed_session.id::pg_catalog.text,
    refreshed_session."expiresAt"::timestamptz
  FROM refreshed_session
$function$;

CREATE FUNCTION public.bootstrap_session_invalidate_v1(input_token text)
RETURNS TABLE (session_id text)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH target_session AS (
    SELECT application_session.id
    FROM public.sessions AS application_session
    WHERE input_token IS NOT NULL
      AND pg_catalog.char_length(input_token) = 43
      AND input_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
      AND application_session.token = input_token
      AND application_session."isActive" IS TRUE
    FOR UPDATE OF application_session
  ),
  invalidated_session AS (
    UPDATE public.sessions AS application_session
    SET
      "updatedAt" = pg_catalog.statement_timestamp(),
      "isActive" = false
    FROM target_session
    WHERE application_session.id = target_session.id
    RETURNING application_session.id
  )
  SELECT invalidated_session.id::pg_catalog.text
  FROM invalidated_session
$function$;

CREATE FUNCTION public.bootstrap_session_revoke_user_org_v1(
  input_user_id text,
  input_organization_id text
)
RETURNS TABLE (session_id text)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH target_sessions AS (
    SELECT application_session.id
    FROM public.sessions AS application_session
    WHERE input_user_id IS NOT NULL
      AND pg_catalog.char_length(input_user_id) BETWEEN 1 AND 255
      AND input_organization_id IS NOT NULL
      AND pg_catalog.char_length(input_organization_id) BETWEEN 1 AND 255
      AND application_session."userId" = input_user_id
      AND application_session."organizationId" = input_organization_id
      AND application_session."isActive" IS TRUE
    FOR UPDATE OF application_session
  ),
  invalidated_sessions AS (
    UPDATE public.sessions AS application_session
    SET
      "updatedAt" = pg_catalog.statement_timestamp(),
      "isActive" = false
    FROM target_sessions
    WHERE application_session.id = target_sessions.id
    RETURNING application_session.id
  )
  SELECT invalidated_sessions.id::pg_catalog.text
  FROM invalidated_sessions
  ORDER BY invalidated_sessions.id
$function$;

CREATE FUNCTION public.bootstrap_session_revoke_user_global_v1(
  input_user_id text,
  input_preserved_session_id text
)
RETURNS TABLE (session_id text)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH target_sessions AS (
    SELECT application_session.id
    FROM public.sessions AS application_session
    WHERE input_user_id IS NOT NULL
      AND pg_catalog.char_length(input_user_id) BETWEEN 1 AND 255
      AND (
        input_preserved_session_id IS NULL
        OR pg_catalog.char_length(input_preserved_session_id) BETWEEN 1 AND 255
      )
      AND application_session."userId" = input_user_id
      AND application_session."isActive" IS TRUE
      AND (
        input_preserved_session_id IS NULL
        OR application_session.id <> input_preserved_session_id
      )
    FOR UPDATE OF application_session
  ),
  invalidated_sessions AS (
    UPDATE public.sessions AS application_session
    SET
      "updatedAt" = pg_catalog.statement_timestamp(),
      "isActive" = false
    FROM target_sessions
    WHERE application_session.id = target_sessions.id
    RETURNING application_session.id
  )
  SELECT invalidated_sessions.id::pg_catalog.text
  FROM invalidated_sessions
  ORDER BY invalidated_sessions.id
$function$;

COMMENT ON FUNCTION public.bootstrap_session_create_v1(
  text,
  text,
  text,
  timestamptz,
  text,
  text
) IS 'vaultspace-contract:w1-2-session-create-v1';

COMMENT ON FUNCTION public.bootstrap_session_refresh_v1(text) IS
  'vaultspace-contract:w1-2-session-refresh-v1';

COMMENT ON FUNCTION public.bootstrap_session_invalidate_v1(text) IS
  'vaultspace-contract:w1-2-session-invalidate-v1';

COMMENT ON FUNCTION public.bootstrap_session_revoke_user_org_v1(text, text) IS
  'vaultspace-contract:w1-2-session-revoke-user-org-v1';

COMMENT ON FUNCTION public.bootstrap_session_revoke_user_global_v1(text, text) IS
  'vaultspace-contract:w1-2-session-revoke-user-global-v1';

REVOKE ALL ON FUNCTION public.bootstrap_session_create_v1(
  text,
  text,
  text,
  timestamptz,
  text,
  text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_session_refresh_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_session_invalidate_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_user_org_v1(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_user_global_v1(text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_app'
  ) THEN
    REVOKE ALL ON FUNCTION public.bootstrap_session_create_v1(
      text,
      text,
      text,
      timestamptz,
      text,
      text
    ) FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_session_refresh_v1(text) FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_session_invalidate_v1(text) FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_user_org_v1(text, text)
      FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_user_global_v1(text, text)
      FROM vaultspace_app;
  END IF;
END
$$;

DO $$
DECLARE
  temporary_membership boolean := false;
BEGIN
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

  ALTER FUNCTION public.bootstrap_session_create_v1(
    text,
    text,
    text,
    timestamptz,
    text,
    text
  ) OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_session_refresh_v1(text)
    OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_session_invalidate_v1(text)
    OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_session_revoke_user_org_v1(text, text)
    OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_session_revoke_user_global_v1(text, text)
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

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  current_table_privileges text[];
  current_write_column_privileges text[];
  invalid_function_rows integer;
  unexpected_acl_rows integer;
  unexpected_runtime_function_rows integer;
BEGIN
  SELECT oid
    INTO owner_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_bootstrap_owner';

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
      MESSAGE = 'BOOTSTRAP_OWNER_SESSION_COLUMN_PRIVILEGES_INVALID';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
    owner_oid,
    'public',
    'USAGE'
  ) OR pg_catalog.has_schema_privilege(
    owner_oid,
    'public',
    'CREATE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_SCHEMA_PRIVILEGES_INVALID';
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
        'bootstrap_session_create_v1',
        'input_user_id text, input_organization_id text, input_token text, input_expires_at timestamp with time zone, input_ip_address text, input_user_agent text',
        'plpgsql',
        'c5eaf4c683685818b4128f178acd74a8',
        'vaultspace-contract:w1-2-session-create-v1'
      ),
      (
        'bootstrap_session_refresh_v1',
        'input_token text',
        'sql',
        'f747a5fedcee62492164961a77355a59',
        'vaultspace-contract:w1-2-session-refresh-v1'
      ),
      (
        'bootstrap_session_invalidate_v1',
        'input_token text',
        'sql',
        'c4b67ed0192a62783a9137a66392cb27',
        'vaultspace-contract:w1-2-session-invalidate-v1'
      ),
      (
        'bootstrap_session_revoke_user_org_v1',
        'input_user_id text, input_organization_id text',
        'sql',
        'f14b7c036c3c23bc48c87088813db04a',
        'vaultspace-contract:w1-2-session-revoke-user-org-v1'
      ),
      (
        'bootstrap_session_revoke_user_global_v1',
        'input_user_id text, input_preserved_session_id text',
        'sql',
        '0cf271c362588da118143a391936f6c6',
        'vaultspace-contract:w1-2-session-revoke-user-global-v1'
      )
  ) AS expected(
    function_name,
    identity_arguments,
    language_name,
    source_md5,
    contract_comment
  )
    ON expected.function_name = function.proname
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      'bootstrap_session_create_v1',
      'bootstrap_session_refresh_v1',
      'bootstrap_session_invalidate_v1',
      'bootstrap_session_revoke_user_org_v1',
      'bootstrap_session_revoke_user_global_v1'
    )
    AND (
      owner.rolname <> 'vaultspace_bootstrap_owner'
      OR pg_catalog.pg_get_function_identity_arguments(function.oid)
        <> expected.identity_arguments
      OR language.lanname <> expected.language_name
      OR function.prosecdef IS DISTINCT FROM true
      OR function.provolatile <> 'v'
      OR function.proparallel <> 'u'
      OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR pg_catalog.md5(function.prosrc) <> expected.source_md5
      OR pg_catalog.obj_description(function.oid, 'pg_proc')
        <> expected.contract_comment
    );

  IF invalid_function_rows <> 0 OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname IN (
        'bootstrap_session_create_v1',
        'bootstrap_session_refresh_v1',
        'bootstrap_session_invalidate_v1',
        'bootstrap_session_revoke_user_org_v1',
        'bootstrap_session_revoke_user_global_v1'
      )
  ) <> 5 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_SESSION_MUTATION_FUNCTION_POSTURE_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unexpected_acl_rows
  FROM pg_catalog.pg_proc AS function
  INNER JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      function.proacl,
      pg_catalog.acldefault('f', function.proowner)
    )
  ) AS acl
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      'bootstrap_session_create_v1',
      'bootstrap_session_refresh_v1',
      'bootstrap_session_invalidate_v1',
      'bootstrap_session_revoke_user_org_v1',
      'bootstrap_session_revoke_user_global_v1'
    )
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> function.proowner;

  IF unexpected_acl_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_SESSION_MUTATION_FUNCTION_ACL_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  IF runtime_oid IS NOT NULL THEN
    SELECT pg_catalog.count(*)::integer
      INTO unexpected_runtime_function_rows
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
      AND pg_catalog.has_function_privilege(
        runtime_oid,
        function.oid,
        'EXECUTE'
      )
      AND function.oid NOT IN (
        pg_catalog.to_regprocedure('public.bootstrap_login_candidate_v1(text)'),
        pg_catalog.to_regprocedure('public.bootstrap_session_resolve_v1(text)'),
        pg_catalog.to_regprocedure('public.bootstrap_organization_resolve_v1(text, text)')
      );

    IF unexpected_runtime_function_rows <> 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BOOTSTRAP_RUNTIME_FUNCTION_MATRIX_INVALID';
    END IF;
  END IF;
END
$$;

COMMIT;
