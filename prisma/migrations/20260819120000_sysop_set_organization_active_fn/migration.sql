-- Privileged path for SysOp organization enable/disable.
--
-- WHY THIS EXISTS: the app's cross-tenant client `bootstrapDb` connects as a role
-- (vaultspace_bootstrap_owner / DATABASE_URL_ADMIN) that is NOBYPASSRLS and holds
-- GRANT UPDATE("updatedAt") ONLY on organizations — it CANNOT write "isActive".
-- Following the codebase's SECURITY DEFINER pattern (bootstrap_login_candidate_v1),
-- org enable/disable goes through a definer function owned by a DEDICATED role with
-- exactly the isActive-write grant and its own broad row policies, isolated from the
-- login role's RESTRICTIVE isActive-filtering policies (which would otherwise hide a
-- disabled org and make re-enabling impossible).
--
-- ⚠️ VALIDATE ON A DATABASE CLONE BEFORE DEPLOY: the RLS policy interaction, the
-- UPDATE ... RETURNING visibility under RLS, and the EXECUTE privilege of the
-- DATABASE_URL_ADMIN role were designed to mirror the proven login function but
-- cannot be verified without a live database.

-- 1. Dedicated NOLOGIN, NOBYPASSRLS owner role for the definer function.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_sysop_owner'
  ) THEN
    CREATE ROLE vaultspace_sysop_owner
      NOLOGIN
      NOINHERIT
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;

-- 2. Minimal privileges: SELECT on the tables needed for the response/counts, and
--    the isActive/updatedAt write on organizations (nothing else, no DELETE).
REVOKE ALL PRIVILEGES ON SCHEMA public FROM vaultspace_sysop_owner;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM vaultspace_sysop_owner;
GRANT USAGE ON SCHEMA public TO vaultspace_sysop_owner;
GRANT SELECT ON TABLE
  public.organizations,
  public.user_organizations,
  public.rooms
TO vaultspace_sysop_owner;
GRANT UPDATE ("isActive", "updatedAt") ON public.organizations TO vaultspace_sysop_owner;

-- 3. Row policies scoped TO this role only (they do not affect any other role).
--    PERMISSIVE + USING(true) so the definer can see AND update ANY organization
--    regardless of its current isActive state or the (absent) org context —
--    required so a DISABLED org can be found and re-enabled.
DROP POLICY IF EXISTS sysop_owner_org_select ON public.organizations;
CREATE POLICY sysop_owner_org_select ON public.organizations
  AS PERMISSIVE FOR SELECT TO vaultspace_sysop_owner USING (true);

DROP POLICY IF EXISTS sysop_owner_org_update ON public.organizations;
CREATE POLICY sysop_owner_org_update ON public.organizations
  AS PERMISSIVE FOR UPDATE TO vaultspace_sysop_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sysop_owner_userorg_select ON public.user_organizations;
CREATE POLICY sysop_owner_userorg_select ON public.user_organizations
  AS PERMISSIVE FOR SELECT TO vaultspace_sysop_owner USING (true);

DROP POLICY IF EXISTS sysop_owner_room_select ON public.rooms;
CREATE POLICY sysop_owner_room_select ON public.rooms
  AS PERMISSIVE FOR SELECT TO vaultspace_sysop_owner USING (true);

-- 4. The definer function: set isActive for exactly one org, return its summary.
CREATE OR REPLACE FUNCTION public.sysop_set_organization_active(
  p_org_id text,
  p_active boolean
)
RETURNS TABLE (
  org_id text,
  org_name text,
  org_slug text,
  is_active boolean
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  UPDATE public.organizations
     SET "isActive" = p_active,
         "updatedAt" = pg_catalog.now()
   WHERE id = p_org_id
  RETURNING
    id::pg_catalog.text AS org_id,
    name::pg_catalog.text AS org_name,
    slug::pg_catalog.text AS org_slug,
    "isActive" AS is_active
$function$;

COMMENT ON FUNCTION public.sysop_set_organization_active(text, boolean) IS
  'vaultspace-contract:sysop-set-organization-active-v1';

-- 5. Lock down EXECUTE: only the cross-tenant admin caller (as with the login
--    function). Revoke from PUBLIC and from the RLS app role.
REVOKE ALL ON FUNCTION public.sysop_set_organization_active(text, boolean) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    REVOKE ALL ON FUNCTION public.sysop_set_organization_active(text, boolean) FROM vaultspace_app;
  END IF;
END
$$;

-- 6. Assign ownership to the dedicated role (temporary membership grant, mirrors
--    the login-function owner-assignment idiom).
DO $$
DECLARE
  temporary_membership boolean := false;
BEGIN
  IF NOT pg_catalog.pg_has_role(CURRENT_USER, 'vaultspace_sysop_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT vaultspace_sysop_owner TO %I', CURRENT_USER);
    temporary_membership := true;
  END IF;

  ALTER FUNCTION public.sysop_set_organization_active(text, boolean)
    OWNER TO vaultspace_sysop_owner;

  IF temporary_membership THEN
    EXECUTE pg_catalog.format('REVOKE vaultspace_sysop_owner FROM %I', CURRENT_USER);
  END IF;
END
$$;

-- 7. Fail-closed posture verification (mirrors the login function's guard): the
--    migration aborts if the function's identity/owner/security posture drifted.
--    ⚠️ EXECUTE grant to the exact DATABASE_URL_ADMIN production principal, and
--    an integration test running as that non-superuser role, remain a required
--    pre-deploy validation step (see the header note) — cannot be asserted here.
DO $$
DECLARE
  fn_oid oid;
BEGIN
  SELECT p.oid INTO fn_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'sysop_set_organization_active';

  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'SYSOP_SET_ORG_ACTIVE_FUNCTION_MISSING';
  END IF;

  IF (SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc WHERE oid = fn_oid)
     IS DISTINCT FROM 'vaultspace_sysop_owner' THEN
    RAISE EXCEPTION 'SYSOP_SET_ORG_ACTIVE_FUNCTION_OWNER_INVALID';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = fn_oid) THEN
    RAISE EXCEPTION 'SYSOP_SET_ORG_ACTIVE_FUNCTION_NOT_SECURITY_DEFINER';
  END IF;

  IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = fn_oid)
     IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
    RAISE EXCEPTION 'SYSOP_SET_ORG_ACTIVE_FUNCTION_SEARCH_PATH_INVALID';
  END IF;

  IF pg_catalog.has_function_privilege('public', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'SYSOP_SET_ORG_ACTIVE_FUNCTION_PUBLIC_EXECUTE';
  END IF;
END
$$;
