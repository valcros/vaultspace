BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  invalid_function_rows integer;
  unexpected_acl_rows integer;
  unexpected_runtime_function_rows integer;
  current_table_privileges text[];
  current_write_column_privileges text[];
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

  IF pg_catalog.has_table_privilege(
    owner_oid,
    'public.sessions',
    'INSERT'
  ) OR pg_catalog.has_table_privilege(
    owner_oid,
    'public.sessions',
    'UPDATE'
  ) OR pg_catalog.has_table_privilege(
    owner_oid,
    'public.sessions',
    'DELETE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_SESSION_TABLE_WRITE_INVALID';
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
    AND acl.grantee <> owner_oid;

  IF unexpected_acl_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_SESSION_MUTATION_PREEXISTING_ACL_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
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
      AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PUBLIC_EXECUTE_PREEXISTING_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  -- Fresh disposable databases create the runtime role after migrations in
  -- scripts/setup-rls-test-db.ts. Production already has the runtime role, so
  -- this migration owns the live grants while the guarded test setup mirrors
  -- and verifies the same exact six-function matrix.
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
      MESSAGE = 'BOOTSTRAP_RUNTIME_PREEXISTING_MATRIX_INVALID';
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

  GRANT EXECUTE ON FUNCTION public.bootstrap_session_create_v1(
    text,
    text,
    text,
    timestamptz,
    text,
    text
  ) TO vaultspace_app;
  GRANT EXECUTE ON FUNCTION public.bootstrap_session_refresh_v1(text)
    TO vaultspace_app;
  GRANT EXECUTE ON FUNCTION public.bootstrap_session_invalidate_v1(text)
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
      MESSAGE = 'BOOTSTRAP_SESSION_MUTATION_RUNTIME_GRANTS_INVALID';
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
      pg_catalog.to_regprocedure('public.bootstrap_organization_resolve_v1(text, text)'),
      pg_catalog.to_regprocedure(
        'public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)'
      ),
      pg_catalog.to_regprocedure('public.bootstrap_session_refresh_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_session_invalidate_v1(text)')
    );

  IF unexpected_runtime_function_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_FUNCTION_MATRIX_INVALID';
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
    AND (
      (
        function.proname IN (
          'bootstrap_session_create_v1',
          'bootstrap_session_refresh_v1',
          'bootstrap_session_invalidate_v1'
        )
        AND acl.grantee NOT IN (owner_oid, runtime_oid)
      )
      OR (
        function.proname IN (
          'bootstrap_session_revoke_user_org_v1',
          'bootstrap_session_revoke_user_global_v1'
        )
        AND acl.grantee <> owner_oid
      )
    );

  IF unexpected_acl_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_SESSION_MUTATION_RUNTIME_ACL_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
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
      AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_PUBLIC_EXECUTE_RUNTIME_INVALID';
  END IF;
END
$$;

COMMIT;
