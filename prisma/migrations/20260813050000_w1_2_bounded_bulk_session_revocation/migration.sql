BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Fail closed unless Unit 8's owner, function, policy, and exact six-function
-- runtime posture are still present. This migration does not repair drift.
DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  invalid_function_rows integer;
  unexpected_runtime_function_rows integer;
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

  IF owner_oid IS NULL OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE roleid = owner_oid
       OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_POSTURE_INVALID';
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

  IF pg_catalog.has_table_privilege(owner_oid, 'public.sessions', 'INSERT')
    OR pg_catalog.has_table_privilege(owner_oid, 'public.sessions', 'UPDATE')
    OR pg_catalog.has_table_privilege(owner_oid, 'public.sessions', 'DELETE')
  THEN
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
      OR pg_catalog.obj_description(function.oid, 'pg_proc') <> expected.contract_comment
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

  IF pg_catalog.to_regprocedure(
    'public.bootstrap_session_revoke_self_others_v1(text)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.bootstrap_session_revoke_admin_user_org_v1(text, text)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_BOUNDED_REVOCATION_FUNCTION_PREEXISTING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'user_organizations'
      AND policy.polname = 'bootstrap_owner_active_membership_login_lookup'
      AND policy.polpermissive IS FALSE
      AND policy.polcmd = 'r'
      AND owner_oid = ANY(policy.polroles)
      AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
        = '("isActive" IS TRUE)'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_MEMBERSHIP_POLICY_PRESTATE_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

  IF runtime_oid IS NULL THEN
    RETURN;
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
  ) OR NOT pg_catalog.has_function_privilege(
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
      pg_catalog.to_regprocedure('public.bootstrap_session_invalidate_v1(text)')
    );

  IF unexpected_runtime_function_rows <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_RUNTIME_PREEXISTING_MATRIX_INVALID';
  END IF;
END
$$;

-- The bounded global wrapper must count every target membership, including an
-- inactive one. Existing bootstrap functions already apply their own explicit
-- active-membership predicates. This owner-specific SELECT policy therefore
-- broadens row visibility only for the no-login definer owner and does not add
-- any table or column write privilege.
DROP POLICY bootstrap_owner_active_membership_login_lookup
  ON public.user_organizations;

CREATE POLICY bootstrap_owner_membership_inventory
ON public.user_organizations
AS PERMISSIVE
FOR SELECT
TO vaultspace_bootstrap_owner
USING (true);

CREATE FUNCTION public.bootstrap_session_revoke_self_others_v1(
  input_actor_token text
)
RETURNS TABLE (
  authorization_proven boolean,
  session_id text
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH authorized_actor AS MATERIALIZED (
    SELECT
      actor_session.id AS actor_session_id,
      actor_session."userId" AS actor_user_id
    FROM public.sessions AS actor_session
    INNER JOIN public.users AS actor_user
      ON actor_user.id = actor_session."userId"
     AND actor_user."isActive" IS TRUE
    INNER JOIN public.user_organizations AS actor_membership
      ON actor_membership."userId" = actor_session."userId"
     AND actor_membership."organizationId" = actor_session."organizationId"
     AND actor_membership."isActive" IS TRUE
    INNER JOIN public.organizations AS actor_organization
      ON actor_organization.id = actor_session."organizationId"
     AND actor_organization."isActive" IS TRUE
    WHERE input_actor_token IS NOT NULL
      AND pg_catalog.char_length(input_actor_token) = 43
      AND input_actor_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
      AND actor_session.token = input_actor_token
      AND actor_session."isActive" IS TRUE
      AND actor_session."organizationId" IS NOT NULL
      AND actor_session."expiresAt" > pg_catalog.statement_timestamp()
      AND actor_session."createdAt" + pg_catalog.make_interval(days => 7)
        >= pg_catalog.statement_timestamp()
    FOR UPDATE OF actor_session
  )
  SELECT
    true AS authorization_proven,
    revoked_session.session_id::pg_catalog.text
  FROM authorized_actor
  LEFT JOIN LATERAL public.bootstrap_session_revoke_user_global_v1(
    authorized_actor.actor_user_id::pg_catalog.text,
    authorized_actor.actor_session_id::pg_catalog.text
  ) AS revoked_session ON true
  ORDER BY revoked_session.session_id NULLS FIRST
$function$;

CREATE FUNCTION public.bootstrap_session_revoke_admin_user_org_v1(
  input_actor_token text,
  input_target_user_id text
)
RETURNS TABLE (
  authorization_proven boolean,
  session_id text
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH authorized_actor AS MATERIALIZED (
    SELECT
      actor_session.id AS actor_session_id,
      actor_session."organizationId" AS actor_organization_id
    FROM public.sessions AS actor_session
    INNER JOIN public.users AS actor_user
      ON actor_user.id = actor_session."userId"
     AND actor_user."isActive" IS TRUE
    INNER JOIN public.user_organizations AS actor_membership
      ON actor_membership."userId" = actor_session."userId"
     AND actor_membership."organizationId" = actor_session."organizationId"
     AND actor_membership."isActive" IS TRUE
     AND actor_membership.role::pg_catalog.text = 'ADMIN'
    INNER JOIN public.organizations AS actor_organization
      ON actor_organization.id = actor_session."organizationId"
     AND actor_organization."isActive" IS TRUE
    WHERE input_actor_token IS NOT NULL
      AND pg_catalog.char_length(input_actor_token) = 43
      AND input_actor_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
      AND actor_session.token = input_actor_token
      AND actor_session."isActive" IS TRUE
      AND actor_session."organizationId" IS NOT NULL
      AND actor_session."expiresAt" > pg_catalog.statement_timestamp()
      AND actor_session."createdAt" + pg_catalog.make_interval(days => 7)
        >= pg_catalog.statement_timestamp()
    FOR UPDATE OF actor_session
  ),
  authorized_target AS MATERIALIZED (
    SELECT
      input_target_user_id AS target_user_id,
      authorized_actor.actor_organization_id
    FROM authorized_actor
    INNER JOIN public.user_organizations AS target_membership
      ON target_membership."userId" = input_target_user_id
     AND target_membership."organizationId" = authorized_actor.actor_organization_id
    WHERE input_target_user_id IS NOT NULL
      AND pg_catalog.char_length(input_target_user_id) BETWEEN 1 AND 255
  )
  SELECT
    true AS authorization_proven,
    revoked_session.session_id::pg_catalog.text
  FROM authorized_target
  LEFT JOIN LATERAL public.bootstrap_session_revoke_user_org_v1(
    authorized_target.target_user_id::pg_catalog.text,
    authorized_target.actor_organization_id::pg_catalog.text
  ) AS revoked_session ON true
  ORDER BY revoked_session.session_id NULLS FIRST
$function$;

CREATE FUNCTION public.bootstrap_session_revoke_admin_user_global_single_org_v1(
  input_actor_token text,
  input_target_user_id text
)
RETURNS TABLE (
  authorization_proven boolean,
  session_id text
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH authorized_actor AS MATERIALIZED (
    SELECT
      actor_session.id AS actor_session_id,
      actor_session."organizationId" AS actor_organization_id
    FROM public.sessions AS actor_session
    INNER JOIN public.users AS actor_user
      ON actor_user.id = actor_session."userId"
     AND actor_user."isActive" IS TRUE
    INNER JOIN public.user_organizations AS actor_membership
      ON actor_membership."userId" = actor_session."userId"
     AND actor_membership."organizationId" = actor_session."organizationId"
     AND actor_membership."isActive" IS TRUE
     AND actor_membership.role::pg_catalog.text = 'ADMIN'
    INNER JOIN public.organizations AS actor_organization
      ON actor_organization.id = actor_session."organizationId"
     AND actor_organization."isActive" IS TRUE
    WHERE input_actor_token IS NOT NULL
      AND pg_catalog.char_length(input_actor_token) = 43
      AND input_actor_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
      AND actor_session.token = input_actor_token
      AND actor_session."isActive" IS TRUE
      AND actor_session."organizationId" IS NOT NULL
      AND actor_session."expiresAt" > pg_catalog.statement_timestamp()
      AND actor_session."createdAt" + pg_catalog.make_interval(days => 7)
        >= pg_catalog.statement_timestamp()
    FOR UPDATE OF actor_session
  ),
  target_membership_inventory AS MATERIALIZED (
    SELECT
      target_membership."userId" AS target_user_id,
      target_membership."organizationId" AS target_organization_id,
      authorized_actor.actor_organization_id
    FROM authorized_actor
    INNER JOIN public.user_organizations AS target_membership
      ON target_membership."userId" = input_target_user_id
    WHERE input_target_user_id IS NOT NULL
      AND pg_catalog.char_length(input_target_user_id) BETWEEN 1 AND 255
    ORDER BY target_membership."organizationId"
  ),
  authorized_target AS MATERIALIZED (
    SELECT
      target_membership_inventory.target_user_id
    FROM target_membership_inventory
    GROUP BY target_membership_inventory.target_user_id
    HAVING pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        target_membership_inventory.target_organization_id
          = target_membership_inventory.actor_organization_id
      )
  )
  SELECT
    true AS authorization_proven,
    revoked_session.session_id::pg_catalog.text
  FROM authorized_target
  LEFT JOIN LATERAL public.bootstrap_session_revoke_user_global_v1(
    authorized_target.target_user_id::pg_catalog.text,
    NULL::pg_catalog.text
  ) AS revoked_session ON true
  ORDER BY revoked_session.session_id NULLS FIRST
$function$;

COMMENT ON FUNCTION public.bootstrap_session_revoke_self_others_v1(text) IS
  'vaultspace-contract:w1-2-session-revoke-self-others-v1';

COMMENT ON FUNCTION public.bootstrap_session_revoke_admin_user_org_v1(text, text) IS
  'vaultspace-contract:w1-2-session-revoke-admin-user-org-v1';

COMMENT ON FUNCTION public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text) IS
  'vaultspace-contract:w1-2-session-revoke-admin-user-global-single-org-v1';

REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_self_others_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_admin_user_org_v1(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)
  FROM PUBLIC;

DO $$
DECLARE
  temporary_membership boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_app'
  ) THEN
    REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_self_others_v1(text)
      FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_admin_user_org_v1(text, text)
      FROM vaultspace_app;
    REVOKE ALL ON FUNCTION public.bootstrap_session_revoke_admin_user_global_single_org_v1(
      text,
      text
    ) FROM vaultspace_app;
  END IF;

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

  ALTER FUNCTION public.bootstrap_session_revoke_self_others_v1(text)
    OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_session_revoke_admin_user_org_v1(text, text)
    OWNER TO vaultspace_bootstrap_owner;
  ALTER FUNCTION public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)
    OWNER TO vaultspace_bootstrap_owner;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vaultspace_app'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.bootstrap_session_revoke_self_others_v1(text)
      TO vaultspace_app;
    GRANT EXECUTE ON FUNCTION public.bootstrap_session_revoke_admin_user_org_v1(text, text)
      TO vaultspace_app;
    GRANT EXECUTE ON FUNCTION public.bootstrap_session_revoke_admin_user_global_single_org_v1(
      text,
      text
    ) TO vaultspace_app;
  END IF;

  IF temporary_membership THEN
    EXECUTE pg_catalog.format(
      'REVOKE vaultspace_bootstrap_owner FROM %I',
      CURRENT_USER
    );
  END IF;

  REVOKE CREATE ON SCHEMA public FROM vaultspace_bootstrap_owner;
END
$$;

-- Final exact catalog proof. The source fingerprints are generated from the
-- reviewed function bodies above and make later drift fail closed.
DO $$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  invalid_function_rows integer;
  unexpected_acl_rows integer;
  unexpected_runtime_function_rows integer;
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'user_organizations'
      AND policy.polname = 'bootstrap_owner_membership_inventory'
      AND policy.polpermissive IS TRUE
      AND policy.polcmd = 'r'
      AND owner_oid = ANY(policy.polroles)
      AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'user_organizations'
      AND policy.polname = 'bootstrap_owner_active_membership_login_lookup'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_MEMBERSHIP_POLICY_FINAL_INVALID';
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
      MESSAGE = 'BOOTSTRAP_OWNER_TABLE_PRIVILEGES_FINAL_INVALID';
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
      MESSAGE = 'BOOTSTRAP_OWNER_SESSION_COLUMN_PRIVILEGES_FINAL_INVALID';
  END IF;

  IF pg_catalog.has_table_privilege(owner_oid, 'public.sessions', 'INSERT')
    OR pg_catalog.has_table_privilege(owner_oid, 'public.sessions', 'UPDATE')
    OR pg_catalog.has_table_privilege(owner_oid, 'public.sessions', 'DELETE')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_OWNER_SESSION_TABLE_WRITE_FINAL_INVALID';
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
        'bootstrap_session_revoke_self_others_v1',
        'input_actor_token text',
        '53dd731ac3f67b9ab0f2de67652310b9',
        'vaultspace-contract:w1-2-session-revoke-self-others-v1'
      ),
      (
        'bootstrap_session_revoke_admin_user_org_v1',
        'input_actor_token text, input_target_user_id text',
        '0447e9f13bb393eae908f35940e21df0',
        'vaultspace-contract:w1-2-session-revoke-admin-user-org-v1'
      ),
      (
        'bootstrap_session_revoke_admin_user_global_single_org_v1',
        'input_actor_token text, input_target_user_id text',
        'cc33204b01dc8cb1b9fc64b518eaecad',
        'vaultspace-contract:w1-2-session-revoke-admin-user-global-single-org-v1'
      )
  ) AS expected(function_name, identity_arguments, source_md5, contract_comment)
    ON expected.function_name = function.proname
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      'bootstrap_session_revoke_self_others_v1',
      'bootstrap_session_revoke_admin_user_org_v1',
      'bootstrap_session_revoke_admin_user_global_single_org_v1'
    )
    AND (
      owner.rolname <> 'vaultspace_bootstrap_owner'
      OR pg_catalog.pg_get_function_identity_arguments(function.oid)
        <> expected.identity_arguments
      OR language.lanname <> 'sql'
      OR function.prosecdef IS DISTINCT FROM true
      OR function.provolatile <> 'v'
      OR function.proparallel <> 'u'
      OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR pg_catalog.md5(function.prosrc) <> expected.source_md5
      OR pg_catalog.obj_description(function.oid, 'pg_proc') <> expected.contract_comment
      OR pg_catalog.pg_get_function_result(function.oid)
        <> 'TABLE(authorization_proven boolean, session_id text)'
    );

  IF invalid_function_rows <> 0 OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS function
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname IN (
        'bootstrap_session_revoke_self_others_v1',
        'bootstrap_session_revoke_admin_user_org_v1',
        'bootstrap_session_revoke_admin_user_global_single_org_v1'
      )
  ) <> 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BOOTSTRAP_BOUNDED_REVOCATION_FUNCTION_POSTURE_INVALID';
  END IF;

  SELECT oid
    INTO runtime_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_app';

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
      'bootstrap_session_revoke_self_others_v1',
      'bootstrap_session_revoke_admin_user_org_v1',
      'bootstrap_session_revoke_admin_user_global_single_org_v1'
    )
    AND acl.privilege_type = 'EXECUTE'
    AND (
      runtime_oid IS NULL
        AND acl.grantee <> owner_oid
      OR runtime_oid IS NOT NULL
        AND acl.grantee NOT IN (owner_oid, runtime_oid)
    );

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
      MESSAGE = 'BOOTSTRAP_BOUNDED_REVOCATION_ACL_INVALID';
  END IF;

  IF runtime_oid IS NULL THEN
    RETURN;
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_self_others_v1(text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_admin_user_org_v1(text, text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    runtime_oid,
    'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)',
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
      MESSAGE = 'BOOTSTRAP_BOUNDED_REVOCATION_RUNTIME_GRANTS_INVALID';
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
      MESSAGE = 'BOOTSTRAP_RUNTIME_FUNCTION_MATRIX_INVALID';
  END IF;
END
$$;

COMMIT;
