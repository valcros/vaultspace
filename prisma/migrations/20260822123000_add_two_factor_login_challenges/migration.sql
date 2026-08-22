-- Short-lived authentication challenges are a control-plane boundary, not
-- tenant content. The ordinary application role has no direct table access.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE TYPE "TwoFactorLoginChallengePurpose" AS ENUM ('TENANT_LOGIN', 'SYSOP_LOGIN');

CREATE TABLE "two_factor_login_challenges" (
  "id" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "userId" VARCHAR(255) NOT NULL,
  "organizationId" VARCHAR(255) NOT NULL,
  "purpose" "TwoFactorLoginChallengePurpose" NOT NULL DEFAULT 'TENANT_LOGIN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "two_factor_login_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "two_factor_login_challenges_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "two_factor_login_challenges_expiry_after_create"
    CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "two_factor_login_challenges_max_lifetime"
    CHECK ("expiresAt" <= "createdAt" + INTERVAL '10 minutes'),
  CONSTRAINT "two_factor_login_challenges_consumed_after_create"
    CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt")
);

CREATE INDEX "two_factor_login_challenges_userId_purpose_expiresAt_idx"
  ON "two_factor_login_challenges"("userId", "purpose", "expiresAt");
CREATE INDEX "two_factor_login_challenges_organizationId_purpose_expiresAt_idx"
  ON "two_factor_login_challenges"("organizationId", "purpose", "expiresAt");

COMMENT ON TABLE "two_factor_login_challenges" IS
  'Short-lived digest-only login challenges. Never store raw browser tokens, TOTP values, backup codes, or MFA secrets.';

DO $$
DECLARE owner_oid oid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_mfa_auth_owner') THEN
    CREATE ROLE vaultspace_mfa_auth_owner
      NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  SELECT oid INTO owner_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vaultspace_mfa_auth_owner'
    AND rolcanlogin IS FALSE
    AND rolinherit IS FALSE
    AND rolsuper IS FALSE
    AND rolbypassrls IS FALSE
    AND rolcreatedb IS FALSE
    AND rolcreaterole IS FALSE
    AND rolreplication IS FALSE;
  IF owner_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = owner_oid OR member = owner_oid
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MFA_AUTH_OWNER_POSTURE_INVALID';
  END IF;
END
$$;

ALTER TABLE "two_factor_login_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "two_factor_login_challenges" FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "two_factor_login_challenges" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    REVOKE ALL PRIVILEGES ON TABLE "two_factor_login_challenges" FROM vaultspace_app;
  END IF;
END
$$;

CREATE POLICY two_factor_login_challenges_owner_only
  ON "two_factor_login_challenges"
  AS PERMISSIVE
  FOR ALL
  TO vaultspace_mfa_auth_owner
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY two_factor_login_challenges_owner_only ON "two_factor_login_challenges" IS
  'Only constrained security-definer MFA challenge functions may access this table.';

GRANT SELECT, INSERT, UPDATE ON "two_factor_login_challenges" TO vaultspace_mfa_auth_owner;
GRANT SELECT ON public.users, public.user_organizations, public.organizations
  TO vaultspace_mfa_auth_owner;

CREATE FUNCTION public.bootstrap_two_factor_challenge_issue_v1(
  input_user_id text,
  input_organization_id text,
  input_token_hash text,
  input_expires_at timestamptz
)
RETURNS TABLE (
  challenge_id text,
  challenge_expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  statement_time timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF input_user_id IS NULL
    OR pg_catalog.char_length(input_user_id) < 1
    OR pg_catalog.char_length(input_user_id) > 255
    OR input_organization_id IS NULL
    OR pg_catalog.char_length(input_organization_id) < 1
    OR pg_catalog.char_length(input_organization_id) > 255
    OR input_token_hash IS NULL
    OR input_token_hash OPERATOR(pg_catalog.!~) '^[a-f0-9]{64}$'
    OR input_expires_at IS NULL
    OR input_expires_at <= statement_time
    OR input_expires_at > statement_time + pg_catalog.make_interval(mins => 5)
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.two_factor_login_challenges (
    "id", "tokenHash", "userId", "organizationId", "purpose",
    "createdAt", "expiresAt"
  )
  SELECT
    pg_catalog.gen_random_uuid()::pg_catalog.text,
    input_token_hash,
    resolved_user.id,
    organization.id,
    'TENANT_LOGIN'::public."TwoFactorLoginChallengePurpose",
    statement_time,
    input_expires_at
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
  ON CONFLICT ("tokenHash") DO NOTHING
  RETURNING id::pg_catalog.text, "expiresAt"::timestamptz;
END
$function$;

COMMENT ON FUNCTION public.bootstrap_two_factor_challenge_issue_v1(
  text, text, text, timestamptz
) IS 'vaultspace-contract:two-factor-challenge-issue-v1';

REVOKE ALL ON FUNCTION public.bootstrap_two_factor_challenge_issue_v1(
  text, text, text, timestamptz
) FROM PUBLIC;

DO $$
DECLARE
  temporary_membership boolean := false;
BEGIN
  GRANT CREATE ON SCHEMA public TO vaultspace_mfa_auth_owner;
  IF NOT pg_catalog.pg_has_role(CURRENT_USER, 'vaultspace_mfa_auth_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT vaultspace_mfa_auth_owner TO %I', CURRENT_USER);
    temporary_membership := true;
  END IF;
  ALTER FUNCTION public.bootstrap_two_factor_challenge_issue_v1(
    text, text, text, timestamptz
  ) OWNER TO vaultspace_mfa_auth_owner;
  IF temporary_membership THEN
    EXECUTE pg_catalog.format('REVOKE vaultspace_mfa_auth_owner FROM %I', CURRENT_USER);
  END IF;
  REVOKE CREATE ON SCHEMA public FROM vaultspace_mfa_auth_owner;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    GRANT EXECUTE ON FUNCTION public.bootstrap_two_factor_challenge_issue_v1(
      text, text, text, timestamptz
    ) TO vaultspace_app;
  END IF;
END
$$;

CREATE FUNCTION public.bootstrap_two_factor_challenge_resolve_v1(input_token text)
RETURNS TABLE (challenge_user_id text, challenge_organization_id text)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT challenge."userId"::pg_catalog.text, challenge."organizationId"::pg_catalog.text
  FROM public.two_factor_login_challenges AS challenge
  WHERE input_token IS NOT NULL
    AND input_token OPERATOR(pg_catalog.~) '^[A-Za-z0-9_-]{43}$'
    AND challenge."tokenHash" = pg_catalog.encode(public.digest(input_token, 'sha256'), 'hex')
    AND challenge.purpose = 'TENANT_LOGIN'::public."TwoFactorLoginChallengePurpose"
    AND challenge."consumedAt" IS NULL
    AND challenge."expiresAt" > pg_catalog.statement_timestamp()
$function$;

REVOKE ALL ON FUNCTION public.bootstrap_two_factor_challenge_resolve_v1(text) FROM PUBLIC;

DO $$
DECLARE temporary_membership boolean := false;
BEGIN
  GRANT CREATE ON SCHEMA public TO vaultspace_mfa_auth_owner;
  IF NOT pg_catalog.pg_has_role(CURRENT_USER, 'vaultspace_mfa_auth_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT vaultspace_mfa_auth_owner TO %I', CURRENT_USER);
    temporary_membership := true;
  END IF;
  ALTER FUNCTION public.bootstrap_two_factor_challenge_resolve_v1(text)
    OWNER TO vaultspace_mfa_auth_owner;
  IF temporary_membership THEN
    EXECUTE pg_catalog.format('REVOKE vaultspace_mfa_auth_owner FROM %I', CURRENT_USER);
  END IF;
  REVOKE CREATE ON SCHEMA public FROM vaultspace_mfa_auth_owner;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    GRANT EXECUTE ON FUNCTION public.bootstrap_two_factor_challenge_resolve_v1(text)
      TO vaultspace_app;
  END IF;
END $$;

COMMIT;
