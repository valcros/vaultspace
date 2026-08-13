-- W1-2 Unit 11 routes password-reset redemption through the two reviewed
-- capability functions. The read-only guard runs outside the DDL transaction
-- so credential or catalog failures remain categorical in Prisma logs.
SET lock_timeout = '10s';
SET statement_timeout = '120s';

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  invalid_function_rows integer;
  unexpected_acl_rows integer;
  unexpected_runtime_function_rows integer;
  runtime_reset_acl_count integer;
  current_table_privileges text[];
  current_write_column_privileges text[];
  current_reset_select_column_privileges text[];
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
    WHERE roleid = owner_oid OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_POSTURE_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  IF runtime_oid IS NOT NULL AND runtime_oid = (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_MIGRATION_RUNTIME_CREDENTIAL_FORBIDDEN';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || ':' || privilege.privilege_type
      ORDER BY privilege.table_name, privilege.privilege_type
    ),
    ARRAY[]::text[]
  ) INTO current_table_privileges
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
  ) INTO current_write_column_privileges
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
      MESSAGE = 'BOOTSTRAP_OWNER_COLUMN_PRIVILEGES_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(
      privilege.table_name || '.' || privilege.column_name
      ORDER BY privilege.table_name, privilege.column_name
    ),
    ARRAY[]::text[]
  ) INTO current_reset_select_column_privileges
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
  ]::text[] OR pg_catalog.has_table_privilege(
    owner_oid, 'public.password_reset_tokens', 'INSERT, UPDATE, DELETE'
  ) OR pg_catalog.has_table_privilege(
    owner_oid, 'public.password_reset_recoveries', 'INSERT, UPDATE, DELETE'
  ) OR pg_catalog.has_table_privilege(
    owner_oid, 'public.sessions', 'INSERT, UPDATE, DELETE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_PASSWORD_RESET_PRIVILEGES_INVALID';
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
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_PREEXISTING_ACL_INVALID';
  END IF;

  -- Disposable migration-chain databases create the runtime role after all
  -- migrations. The guarded setup script mirrors the same two grants later.
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
  ) OR pg_catalog.pg_has_role(runtime_oid, owner_oid, 'MEMBER') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_ROLE_POSTURE_INVALID';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_login_candidate_v1(text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_resolve_v1(text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_organization_resolve_v1(text, text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_refresh_v1(text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_invalidate_v1(text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_revoke_self_others_v1(text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_admin_user_org_v1(text, text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_password_reset_candidate_v1(text)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_password_reset_redeem_v1(text, text)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_revoke_user_org_v1(text, text)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_revoke_user_global_v1(text, text)', 'EXECUTE'
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

  IF unexpected_runtime_function_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_PREEXISTING_MATRIX_INVALID';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO runtime_reset_acl_count
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

  IF runtime_reset_acl_count <> 152 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_RESET_PRIVILEGE_PRESTATE_INVALID';
  END IF;
END
$$;

BEGIN;

CREATE TEMPORARY TABLE unit11_runtime_reset_acl_prestate (
  acl_key text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO unit11_runtime_reset_acl_prestate (acl_key)
SELECT acl_key
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

DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  temporary_membership boolean := false;
  unexpected_acl_rows integer;
  unexpected_runtime_function_rows integer;
  expected_runtime_reset_acl text[];
  current_runtime_reset_acl text[];
BEGIN
  SELECT oid INTO owner_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_bootstrap_owner';

  SELECT oid INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  IF runtime_oid IS NULL THEN
    RETURN;
  END IF;

  IF NOT pg_catalog.pg_has_role(CURRENT_USER, owner_oid, 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT vaultspace_bootstrap_owner TO %I', CURRENT_USER);
    temporary_membership := true;
  END IF;

  GRANT EXECUTE ON FUNCTION public.bootstrap_password_reset_candidate_v1(text)
    TO vaultspace_app;
  GRANT EXECUTE ON FUNCTION public.bootstrap_password_reset_redeem_v1(text, text)
    TO vaultspace_app;

  IF temporary_membership THEN
    EXECUTE pg_catalog.format('REVOKE vaultspace_bootstrap_owner FROM %I', CURRENT_USER);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE roleid = owner_oid OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_MEMBERSHIP_RESTORE_INVALID';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_password_reset_candidate_v1(text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_password_reset_redeem_v1(text, text)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_revoke_user_org_v1(text, text)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    runtime_oid, 'public.bootstrap_session_revoke_user_global_v1(text, text)', 'EXECUTE'
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
      ),
      pg_catalog.to_regprocedure('public.bootstrap_password_reset_candidate_v1(text)'),
      pg_catalog.to_regprocedure('public.bootstrap_password_reset_redeem_v1(text, text)')
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
    COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
  ) AS acl
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      'bootstrap_password_reset_candidate_v1',
      'bootstrap_password_reset_redeem_v1'
    )
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee NOT IN (owner_oid, runtime_oid);

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
      MESSAGE = 'BOOTSTRAP_PASSWORD_RESET_RUNTIME_ACL_INVALID';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(acl_key ORDER BY acl_key COLLATE pg_catalog."C"),
    ARRAY[]::text[]
  ) INTO expected_runtime_reset_acl
  FROM unit11_runtime_reset_acl_prestate;

  SELECT COALESCE(
    pg_catalog.array_agg(acl_key ORDER BY acl_key COLLATE pg_catalog."C"),
    ARRAY[]::text[]
  ) INTO current_runtime_reset_acl
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
END
$$;

COMMIT;
