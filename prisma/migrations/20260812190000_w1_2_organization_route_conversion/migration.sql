BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  function_oid oid;
  unexpected_acl_rows integer;
  unexpected_runtime_function_rows integer;
  temporary_membership boolean := false;
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
    'public.bootstrap_organization_resolve_v1(text, text)'
  )
    AND pg_catalog.pg_get_function_identity_arguments(oid) =
      'input_lookup_kind text, input_lookup_value text'
    AND proowner = owner_oid
    AND prolang = (
      SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql'
    )
    AND prosecdef IS TRUE
    AND provolatile = 's'
    AND proparallel = 'r'
    AND proconfig = ARRAY['search_path=pg_catalog']::text[]
    AND pg_catalog.md5(prosrc) = '9722fc054bf5a40a5920c7b0bb587758'
    AND pg_catalog.obj_description(oid, 'pg_proc') =
      'vaultspace-contract:w1-2-organization-resolve-v1';

  IF function_oid IS NULL OR (
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
      MESSAGE = 'BOOTSTRAP_ORGANIZATION_PREEXISTING_ACL_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  -- A pristine disposable database creates the runtime role after migrations
  -- in scripts/setup-rls-test-db.ts. That guarded setup applies and verifies
  -- the same exact grants. Production already has the runtime role, so this
  -- migration owns the live organization grant.
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

  IF NOT pg_catalog.pg_has_role(
    CURRENT_USER,
    owner_oid,
    'MEMBER'
  ) THEN
    EXECUTE pg_catalog.format(
      'GRANT vaultspace_bootstrap_owner TO %I',
      CURRENT_USER
    );
    temporary_membership := true;
  END IF;

  GRANT EXECUTE ON FUNCTION public.bootstrap_organization_resolve_v1(text, text)
    TO vaultspace_app;

  IF temporary_membership THEN
    EXECUTE pg_catalog.format(
      'REVOKE vaultspace_bootstrap_owner FROM %I',
      CURRENT_USER
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE roleid = owner_oid
       OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_MEMBERSHIP_RESTORE_INVALID';
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
    function_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_ORGANIZATION_RUNTIME_GRANT_INVALID';
  END IF;

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
      function_oid
    );

  IF unexpected_runtime_function_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_FUNCTION_MATRIX_INVALID';
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
      MESSAGE = 'BOOTSTRAP_ORGANIZATION_RUNTIME_ACL_INVALID';
  END IF;
END
$$;

COMMIT;
