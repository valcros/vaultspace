BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  function_oid oid;
  unexpected_acl_rows integer;
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
    INTO function_oid
  FROM pg_catalog.pg_proc
  WHERE oid = pg_catalog.to_regprocedure(
    'public.bootstrap_login_candidate_v1(text)'
  )
    AND pg_catalog.pg_get_function_identity_arguments(oid) = 'input_email text'
    AND proowner = owner_oid
    AND prolang = (
      SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql'
    )
    AND prosecdef IS TRUE
    AND provolatile = 's'
    AND proparallel = 'r'
    AND proconfig = ARRAY['search_path=pg_catalog']::text[]
    AND pg_catalog.md5(prosrc) = '8aa437903650cd2be037ca7ff08ac608'
    AND pg_catalog.obj_description(oid, 'pg_proc') =
      'vaultspace-contract:w1-2-login-candidate-v1';

  IF function_oid IS NULL OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = 'bootstrap_login_candidate_v1'
  ) <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_LOGIN_FUNCTION_POSTURE_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unexpected_acl_rows
  FROM pg_catalog.aclexplode(
    COALESCE(
      (SELECT proacl FROM pg_catalog.pg_proc WHERE oid = function_oid),
      pg_catalog.acldefault('f', owner_oid)
    )
  ) AS acl
  WHERE acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> owner_oid;

  IF unexpected_acl_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_LOGIN_PREEXISTING_ACL_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  -- A pristine disposable database creates the runtime role after migrations
  -- in scripts/setup-rls-test-db.ts. That guarded setup applies and verifies
  -- the same exact grant. Production already has the runtime role, so this
  -- migration owns the live grant.
  IF runtime_oid IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE oid = runtime_oid
      AND (
        rolcanlogin IS FALSE
        OR rolsuper
        OR rolbypassrls
        OR rolcreatedb
        OR rolcreaterole
        OR rolreplication
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_ROLE_POSTURE_INVALID';
  END IF;

  IF pg_catalog.pg_has_role(
    runtime_oid,
    owner_oid,
    'MEMBER'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_RUNTIME_REACHABILITY_INVALID';
  END IF;

  GRANT EXECUTE ON FUNCTION public.bootstrap_login_candidate_v1(text)
    TO vaultspace_app;

  IF NOT pg_catalog.has_function_privilege(
    runtime_oid,
    function_oid,
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_resolve_v1(text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_organization_resolve_v1(text, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_LOGIN_RUNTIME_GRANT_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unexpected_acl_rows
  FROM pg_catalog.aclexplode(
    COALESCE(
      (SELECT proacl FROM pg_catalog.pg_proc WHERE oid = function_oid),
      pg_catalog.acldefault('f', owner_oid)
    )
  ) AS acl
  WHERE acl.privilege_type = 'EXECUTE'
    AND acl.grantee NOT IN (owner_oid, runtime_oid);

  IF unexpected_acl_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_LOGIN_RUNTIME_ACL_INVALID';
  END IF;
END
$$;

COMMIT;
