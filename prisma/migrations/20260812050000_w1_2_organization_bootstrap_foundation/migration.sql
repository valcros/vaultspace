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
    'sessions:SELECT',
    'user_organizations:SELECT',
    'users:SELECT'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_PREEXISTING_TABLE_PRIVILEGES_INVALID';
  END IF;
END
$$;

CREATE FUNCTION public.bootstrap_organization_resolve_v1(
  input_lookup_kind text,
  input_lookup_value text
)
RETURNS TABLE (
  organization_id text,
  organization_name text,
  organization_slug text,
  organization_custom_domain text,
  organization_logo_url text,
  organization_primary_color text,
  organization_favicon_url text
)
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    organization.id::pg_catalog.text AS organization_id,
    organization.name::pg_catalog.text AS organization_name,
    organization.slug::pg_catalog.text AS organization_slug,
    organization."customDomain"::pg_catalog.text AS organization_custom_domain,
    organization."logoUrl"::pg_catalog.text AS organization_logo_url,
    organization."primaryColor"::pg_catalog.text AS organization_primary_color,
    organization."faviconUrl"::pg_catalog.text AS organization_favicon_url
  FROM public.organizations AS organization
  WHERE organization."isActive" IS TRUE
    AND input_lookup_kind IS NOT NULL
    AND input_lookup_value IS NOT NULL
    AND (
      (
        input_lookup_kind = 'SLUG'
        AND pg_catalog.char_length(input_lookup_value) BETWEEN 1 AND 100
        AND input_lookup_value OPERATOR(pg_catalog.~) '^[a-z0-9-]+$'
        AND organization.slug = input_lookup_value
      )
      OR
      (
        input_lookup_kind = 'CUSTOM_DOMAIN'
        AND pg_catalog.char_length(input_lookup_value) BETWEEN 1 AND 255
        AND input_lookup_value OPERATOR(pg_catalog.~)
          '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
        AND organization."customDomain" = input_lookup_value
      )
    )
  LIMIT 1
$function$;

COMMENT ON FUNCTION public.bootstrap_organization_resolve_v1(text, text) IS
  'vaultspace-contract:w1-2-organization-resolve-v1';

REVOKE ALL ON FUNCTION public.bootstrap_organization_resolve_v1(text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_app'
  ) THEN
    REVOKE ALL ON FUNCTION public.bootstrap_organization_resolve_v1(text, text)
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

  ALTER FUNCTION public.bootstrap_organization_resolve_v1(text, text)
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
    AND function.proname = 'bootstrap_organization_resolve_v1'
    AND (
      pg_catalog.pg_get_function_identity_arguments(function.oid) <>
        'input_lookup_kind text, input_lookup_value text'
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
      AND function.proname = 'bootstrap_organization_resolve_v1'
  ) <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_ORGANIZATION_FUNCTION_POSTURE_INVALID';
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
    AND function.proname = 'bootstrap_organization_resolve_v1'
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> function.proowner;

  IF unexpected_acl_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_ORGANIZATION_FUNCTION_ACL_INVALID';
  END IF;
END
$$;

COMMIT;
