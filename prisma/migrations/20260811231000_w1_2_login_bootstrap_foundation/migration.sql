BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_bootstrap_owner'
  ) THEN
    CREATE ROLE vaultspace_bootstrap_owner
      NOLOGIN
      NOINHERIT
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION;
  ELSIF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_bootstrap_owner'
      AND (
        rolcanlogin
        OR rolinherit
        OR rolsuper
        OR rolbypassrls
        OR rolcreatedb
        OR rolcreaterole
        OR rolreplication
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_PREEXISTING_POSTURE_INVALID';
  END IF;
END
$$;

DO $$
DECLARE
  owner_oid oid;
BEGIN
  SELECT oid
    INTO owner_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_bootstrap_owner';

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE roleid = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_MEMBERSHIP_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE relowner = owner_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE proowner = owner_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace
    WHERE nspowner = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_UNEXPECTED_OWNERSHIP';
  END IF;
END
$$;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM vaultspace_bootstrap_owner;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM vaultspace_bootstrap_owner;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM vaultspace_bootstrap_owner;

GRANT USAGE ON SCHEMA public TO vaultspace_bootstrap_owner;
GRANT SELECT ON TABLE
  public.users,
  public.user_organizations,
  public.organizations
TO vaultspace_bootstrap_owner;

CREATE POLICY bootstrap_owner_active_user_login_lookup
ON public.users
AS RESTRICTIVE
FOR SELECT
TO vaultspace_bootstrap_owner
USING ("isActive" IS TRUE);

CREATE POLICY bootstrap_owner_active_membership_login_lookup
ON public.user_organizations
AS RESTRICTIVE
FOR SELECT
TO vaultspace_bootstrap_owner
USING ("isActive" IS TRUE);

CREATE POLICY bootstrap_owner_active_organization_login_lookup
ON public.organizations
AS RESTRICTIVE
FOR SELECT
TO vaultspace_bootstrap_owner
USING ("isActive" IS TRUE);

CREATE FUNCTION public.bootstrap_login_candidate_v1(input_email text)
RETURNS TABLE (
  user_id text,
  normalized_email text,
  first_name text,
  last_name text,
  password_hash text,
  user_is_active boolean,
  two_factor_enabled boolean,
  organization_id text,
  organization_name text,
  organization_slug text,
  organization_role text
)
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    candidate_user.id::pg_catalog.text AS user_id,
    candidate_user.email::pg_catalog.text AS normalized_email,
    candidate_user."firstName"::pg_catalog.text AS first_name,
    candidate_user."lastName"::pg_catalog.text AS last_name,
    candidate_user."passwordHash"::pg_catalog.text AS password_hash,
    candidate_user."isActive" AS user_is_active,
    candidate_user."twoFactorEnabled" AS two_factor_enabled,
    membership."organizationId"::pg_catalog.text AS organization_id,
    organization.name::pg_catalog.text AS organization_name,
    organization.slug::pg_catalog.text AS organization_slug,
    membership.role::pg_catalog.text AS organization_role
  FROM public.users AS candidate_user
  INNER JOIN public.user_organizations AS membership
    ON membership."userId" = candidate_user.id
   AND membership."isActive" IS TRUE
  INNER JOIN public.organizations AS organization
    ON organization.id = membership."organizationId"
   AND organization."isActive" IS TRUE
  WHERE input_email IS NOT NULL
    AND pg_catalog.char_length(pg_catalog.btrim(input_email)) BETWEEN 3 AND 255
    AND candidate_user.email = pg_catalog.lower(pg_catalog.btrim(input_email))
    AND candidate_user."isActive" IS TRUE
  ORDER BY
    membership."createdAt" ASC,
    membership.id COLLATE pg_catalog."C" ASC
  LIMIT 1
$function$;

COMMENT ON FUNCTION public.bootstrap_login_candidate_v1(text) IS
  'vaultspace-contract:w1-2-login-candidate-v1';

REVOKE ALL ON FUNCTION public.bootstrap_login_candidate_v1(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_app'
  ) THEN
    REVOKE ALL ON FUNCTION public.bootstrap_login_candidate_v1(text) FROM vaultspace_app;
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

  ALTER FUNCTION public.bootstrap_login_candidate_v1(text)
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
  invalid_role_rows integer;
  invalid_function_rows integer;
  unexpected_acl_rows integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO invalid_role_rows
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_bootstrap_owner'
    AND (
      rolcanlogin
      OR rolinherit
      OR rolsuper
      OR rolbypassrls
      OR rolcreatedb
      OR rolcreaterole
      OR rolreplication
    );

  IF invalid_role_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_POSTURE_INVALID';
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
    AND function.proname = 'bootstrap_login_candidate_v1'
    AND (
      pg_catalog.pg_get_function_identity_arguments(function.oid) <> 'input_email text'
      OR owner.rolname <> 'vaultspace_bootstrap_owner'
      OR language.lanname <> 'sql'
      OR function.prosecdef IS DISTINCT FROM true
      OR function.provolatile <> 's'
      OR function.proparallel <> 'r'
      OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    );

  IF invalid_function_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_LOGIN_FUNCTION_POSTURE_INVALID';
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
    AND function.proname = 'bootstrap_login_candidate_v1'
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> function.proowner;

  IF unexpected_acl_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_LOGIN_FUNCTION_ACL_INVALID';
  END IF;
END
$$;

COMMIT;
