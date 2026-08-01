BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- No approved provider-final projector exists before this migration. Freeze
-- password-reset writers while proving that no unaudited final evidence has
-- already been populated and while installing the permanent write boundary.
LOCK TABLE public.password_reset_tokens IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.password_reset_tokens token
    WHERE pg_catalog.num_nonnulls(
      token."providerFinalStatus",
      token."providerFinalOutcome",
      token."providerFinalEventAt",
      token."providerFinalRecordedAt",
      token."providerFinalEventIdFingerprint"
    ) > 0
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PASSWORD_RESET_PROVIDER_FINAL_PREEXISTING_EVIDENCE';
  END IF;
END;
$$;

ALTER TABLE public.password_reset_tokens
  ADD CONSTRAINT password_reset_provider_final_evidence_complete_check
  CHECK (
    pg_catalog.num_nonnulls(
      "providerFinalStatus",
      "providerFinalOutcome",
      "providerFinalEventAt",
      "providerFinalRecordedAt",
      "providerFinalEventIdFingerprint"
    ) = 0
    OR (
      pg_catalog.num_nonnulls(
        "providerFinalStatus",
        "providerFinalOutcome",
        "providerFinalEventAt",
        "providerFinalRecordedAt",
        "providerFinalEventIdFingerprint"
      ) = 5
      AND (
        ("providerFinalStatus" = 'Delivered' AND "providerFinalOutcome" = 'SUCCESS')
        OR (
          "providerFinalStatus" IN (
            'Suppressed',
            'Bounced',
            'Quarantined',
            'FilteredSpam',
            'Expanded',
            'Failed'
          )
          AND "providerFinalOutcome" = 'FAILURE'
        )
      )
      AND "providerFinalEventIdFingerprint" ~ '^[0-9a-f]{64}$'
    )
  );

CREATE FUNCTION public.guard_password_reset_provider_final_evidence()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  caller_is_exact_table_owner boolean;
  old_final_field_count integer := 0;
  new_final_field_count integer;
BEGIN
  SELECT relation.relowner = caller_role.oid
    INTO caller_is_exact_table_owner
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_roles caller_role
    ON caller_role.rolname = CURRENT_USER
  WHERE relation.oid = TG_RELID;

  IF COALESCE(caller_is_exact_table_owner, false) IS NOT TRUE THEN
    caller_is_exact_table_owner := false;
  END IF;

  new_final_field_count := pg_catalog.num_nonnulls(
    NEW."providerFinalStatus",
    NEW."providerFinalOutcome",
    NEW."providerFinalEventAt",
    NEW."providerFinalRecordedAt",
    NEW."providerFinalEventIdFingerprint"
  );

  IF TG_OP = 'UPDATE' THEN
    old_final_field_count := pg_catalog.num_nonnulls(
      OLD."providerFinalStatus",
      OLD."providerFinalOutcome",
      OLD."providerFinalEventAt",
      OLD."providerFinalRecordedAt",
      OLD."providerFinalEventIdFingerprint"
    );

    IF old_final_field_count = 5
       AND ROW(
         NEW."providerFinalStatus",
         NEW."providerFinalOutcome",
         NEW."providerFinalEventAt",
         NEW."providerFinalRecordedAt",
         NEW."providerFinalEventIdFingerprint"
       ) IS DISTINCT FROM ROW(
         OLD."providerFinalStatus",
         OLD."providerFinalOutcome",
         OLD."providerFinalEventAt",
         OLD."providerFinalRecordedAt",
         OLD."providerFinalEventIdFingerprint"
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_IMMUTABLE';
    END IF;
  END IF;

  IF new_final_field_count > 0
     AND old_final_field_count = 0
     AND caller_is_exact_table_owner IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PASSWORD_RESET_PROVIDER_FINAL_EVIDENCE_OWNER_REQUIRED';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger functions do not need direct execution privileges. Remove grants
-- inherited from PUBLIC or installation-specific default privileges.
REVOKE ALL ON FUNCTION public.guard_password_reset_provider_final_evidence() FROM PUBLIC;
DO $$
DECLARE
  granted_role record;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT
      acl.grantee AS grantee_oid,
      grantee.rolname AS grantee_name
    FROM pg_catalog.pg_proc function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    WHERE function.oid =
      'public.guard_password_reset_provider_final_evidence()'::pg_catalog.regprocedure
      AND acl.grantee <> function.proowner
  LOOP
    IF granted_role.grantee_oid = 0 THEN
      EXECUTE
        'REVOKE ALL ON FUNCTION public.guard_password_reset_provider_final_evidence() FROM PUBLIC';
    ELSE
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION public.guard_password_reset_provider_final_evidence() FROM %I',
        granted_role.grantee_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE TRIGGER password_reset_provider_final_evidence_guard
BEFORE INSERT OR UPDATE OF
  "providerFinalStatus",
  "providerFinalOutcome",
  "providerFinalEventAt",
  "providerFinalRecordedAt",
  "providerFinalEventIdFingerprint"
ON public.password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION public.guard_password_reset_provider_final_evidence();

-- Fail the migration if a protected-name overload, owner drift, unsafe
-- function posture, unexpected function ACL, trigger mismatch, or weakened
-- provider-final constraint exists.
DO $$
DECLARE
  expected_function oid :=
    'public.guard_password_reset_provider_final_evidence()'::pg_catalog.regprocedure;
  expected_owner oid;
  expected_trigger_definition text :=
    'CREATE TRIGGER password_reset_provider_final_evidence_guard BEFORE INSERT OR UPDATE OF "providerFinalStatus", "providerFinalOutcome", "providerFinalEventAt", "providerFinalRecordedAt", "providerFinalEventIdFingerprint" ON public.password_reset_tokens FOR EACH ROW EXECUTE FUNCTION guard_password_reset_provider_final_evidence()';
BEGIN
  SELECT relation.relowner
    INTO expected_owner
  FROM pg_catalog.pg_class relation
  WHERE relation.oid = 'public.password_reset_tokens'::pg_catalog.regclass;

  IF expected_owner IS NULL
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_proc function
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname = 'public'
         AND function.proname = 'guard_password_reset_provider_final_evidence'
     ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc function
       JOIN pg_catalog.pg_language language ON language.oid = function.prolang
       WHERE function.oid = expected_function
         AND function.proowner = expected_owner
         AND function.prosecdef = false
         AND function.provolatile = 'v'
         AND function.proretset = false
         AND function.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
         AND language.lanname = 'plpgsql'
         AND function.proconfig = ARRAY['search_path=pg_catalog']::text[]
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc function
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
       ) acl
       WHERE function.oid = expected_function
         AND acl.grantee <> function.proowner
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger trigger
       WHERE trigger.tgrelid = 'public.password_reset_tokens'::pg_catalog.regclass
         AND trigger.tgname = 'password_reset_provider_final_evidence_guard'
         AND trigger.tgfoid = expected_function
         AND trigger.tgenabled = 'O'
         AND trigger.tgtype = 23
         AND NOT trigger.tgisinternal
         AND pg_catalog.pg_get_triggerdef(trigger.oid) = expected_trigger_definition
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint constraint_row
       WHERE constraint_row.conrelid = 'public.password_reset_tokens'::pg_catalog.regclass
         AND constraint_row.conname = 'password_reset_provider_final_evidence_complete_check'
         AND constraint_row.contype = 'c'
         AND constraint_row.convalidated
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%num_nonnulls%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%Delivered%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%Suppressed%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%Bounced%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%Quarantined%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%FilteredSpam%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%Expanded%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%Failed%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%SUCCESS%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%FAILURE%'
         AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%^[0-9a-f]{64}$%'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PASSWORD_RESET_PROVIDER_FINAL_POSTURE_INVALID';
  END IF;
END;
$$;

COMMIT;
