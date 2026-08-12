BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  runtime_reaches_owner boolean := false;
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
END
$$;

DO $$
DECLARE
  current_privileges text[];
BEGIN
  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  )
    INTO current_privileges
  FROM information_schema.table_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner';

  IF current_privileges IS DISTINCT FROM ARRAY[
    'organizations:SELECT',
    'user_organizations:SELECT',
    'users:SELECT'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_PREEXISTING_TABLE_PRIVILEGES_INVALID';
  END IF;
END
$$;

GRANT SELECT ON TABLE public.sessions TO vaultspace_bootstrap_owner;

CREATE FUNCTION public.bootstrap_session_resolve_v1(input_token text)
RETURNS TABLE (
  session_id text,
  user_id text,
  organization_id text,
  session_created_at timestamptz,
  session_expires_at timestamptz,
  session_last_active_at timestamptz,
  user_email text,
  user_first_name text,
  user_last_name text,
  user_is_active boolean,
  organization_name text,
  organization_slug text,
  organization_role text,
  can_manage_users boolean,
  can_manage_rooms boolean
)
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    application_session.id::pg_catalog.text AS session_id,
    application_session."userId"::pg_catalog.text AS user_id,
    application_session."organizationId"::pg_catalog.text AS organization_id,
    application_session."createdAt" AS session_created_at,
    application_session."expiresAt" AS session_expires_at,
    application_session."lastActiveAt" AS session_last_active_at,
    resolved_user.email::pg_catalog.text AS user_email,
    resolved_user."firstName"::pg_catalog.text AS user_first_name,
    resolved_user."lastName"::pg_catalog.text AS user_last_name,
    resolved_user."isActive" AS user_is_active,
    organization.name::pg_catalog.text AS organization_name,
    organization.slug::pg_catalog.text AS organization_slug,
    membership.role::pg_catalog.text AS organization_role,
    membership."canManageUsers" AS can_manage_users,
    membership."canManageRooms" AS can_manage_rooms
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
      >= pg_catalog.statement_timestamp()
  LIMIT 1
$function$;

COMMENT ON FUNCTION public.bootstrap_session_resolve_v1(text) IS
  'vaultspace-contract:w1-2-session-resolve-v1';

REVOKE ALL ON FUNCTION public.bootstrap_session_resolve_v1(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_app'
  ) THEN
    REVOKE ALL ON FUNCTION public.bootstrap_session_resolve_v1(text) FROM vaultspace_app;
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

  ALTER FUNCTION public.bootstrap_session_resolve_v1(text)
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
  current_privileges text[];
  invalid_function_rows integer;
  unexpected_acl_rows integer;
BEGIN
  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  )
    INTO current_privileges
  FROM information_schema.table_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee = 'vaultspace_bootstrap_owner';

  IF current_privileges IS DISTINCT FROM ARRAY[
    'organizations:SELECT',
    'sessions:SELECT',
    'user_organizations:SELECT',
    'users:SELECT'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_TABLE_PRIVILEGES_INVALID';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
    'vaultspace_bootstrap_owner',
    'public',
    'USAGE'
  ) OR pg_catalog.has_schema_privilege(
    'vaultspace_bootstrap_owner',
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
  WHERE namespace.nspname = 'public'
    AND function.proname = 'bootstrap_session_resolve_v1'
    AND (
      pg_catalog.pg_get_function_identity_arguments(function.oid) <> 'input_token text'
      OR owner.rolname <> 'vaultspace_bootstrap_owner'
      OR language.lanname <> 'sql'
      OR function.prosecdef IS DISTINCT FROM true
      OR function.provolatile <> 's'
      OR function.proparallel <> 'r'
      OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    );

  IF invalid_function_rows <> 0 OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = 'bootstrap_session_resolve_v1'
  ) <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_SESSION_FUNCTION_POSTURE_INVALID';
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
    AND function.proname = 'bootstrap_session_resolve_v1'
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> function.proowner;

  IF unexpected_acl_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_SESSION_FUNCTION_ACL_INVALID';
  END IF;
END
$$;

COMMIT;
