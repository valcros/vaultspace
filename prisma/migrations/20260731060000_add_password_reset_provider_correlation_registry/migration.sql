BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Freeze both halves of the authoritative tuple while the compatibility
-- trigger is installed and existing trusted V1 acceptances are registered.
LOCK TABLE public.password_reset_tokens,
           public.password_reset_recoveries
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.password_reset_recoveries
  ADD CONSTRAINT password_reset_recoveries_flow_operation_key
  UNIQUE ("flowId", "providerOperationId");

CREATE TABLE public.password_reset_provider_correlations (
  "flowId" TEXT NOT NULL,
  provider VARCHAR(32) COLLATE "C" NOT NULL,
  "providerOperationId" VARCHAR(255) COLLATE "C" NOT NULL,
  "providerMessageId" VARCHAR(255) COLLATE "C" NOT NULL,
  "providerAcceptedAt" TIMESTAMP(3) NOT NULL,
  "correlationSchemaVersion" INTEGER NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT password_reset_provider_correlations_pkey PRIMARY KEY ("flowId"),
  CONSTRAINT password_reset_provider_correlations_provider_check
    CHECK (provider = 'acs'),
  CONSTRAINT password_reset_provider_correlations_contract_check
    CHECK ("correlationSchemaVersion" = 1),
  CONSTRAINT password_reset_provider_correlations_operation_flow_check
    CHECK ("providerOperationId" = "flowId"),
  CONSTRAINT password_reset_provider_correlations_identifier_shape_check
    CHECK (
      "providerOperationId" <> ''
      AND "providerOperationId" = btrim("providerOperationId")
      AND "providerMessageId" <> ''
      AND "providerMessageId" = btrim("providerMessageId")
    ),
  CONSTRAINT password_reset_provider_correlations_token_fkey
    FOREIGN KEY ("flowId")
    REFERENCES public.password_reset_tokens(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT password_reset_provider_correlations_recovery_fkey
    FOREIGN KEY ("flowId", "providerOperationId")
    REFERENCES public.password_reset_recoveries("flowId", "providerOperationId")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX password_reset_provider_correlations_provider_operation_key
  ON public.password_reset_provider_correlations(provider, "providerOperationId");
CREATE UNIQUE INDEX password_reset_provider_correlations_flow_operation_key
  ON public.password_reset_provider_correlations("flowId", "providerOperationId");
CREATE UNIQUE INDEX password_reset_provider_correlations_provider_message_key
  ON public.password_reset_provider_correlations(provider, "providerMessageId");
CREATE INDEX password_reset_provider_correlations_recorded_idx
  ON public.password_reset_provider_correlations("recordedAt");

REVOKE ALL ON TABLE public.password_reset_provider_correlations FROM PUBLIC;
DO $$
DECLARE
  granted_role record;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT grantee
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = 'password_reset_provider_correlations'
      AND grantee <> current_user
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.password_reset_provider_correlations FROM %I',
      granted_role.grantee
    );
  END LOOP;
END;
$$;

-- Source validity excludes mutable lifecycle status. Once a correlation is
-- registered, cancellation, redemption, supersession, or expiry may advance
-- the reset without invalidating the immutable provider-acceptance evidence.
CREATE FUNCTION public.password_reset_provider_correlation_source_valid(
  token_row public.password_reset_tokens,
  recovery_row public.password_reset_recoveries
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT
    ($1)."providerCorrelationSchemaVersion" = 1
    AND ($1).token ~ '^prh1:[0-9a-f]{64}$'
    AND ($1).provider = 'acs'
    AND ($1)."providerOperationId" = ($1).id
    AND ($1)."providerMessageId" IS NOT NULL
    AND ($1)."providerMessageId" <> ''
    AND ($1)."providerMessageId" = btrim(($1)."providerMessageId")
    AND ($1)."providerAcceptedAt" IS NOT NULL
    AND cardinality(($1)."auditOrganizationIds") BETWEEN 1 AND 64
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(($1)."auditOrganizationIds") AS scope(scope_id)
      WHERE scope_id IS NULL
         OR scope_id = ''
         OR scope_id <> btrim(scope_id)
         OR length(scope_id) > 100
         OR scope_id !~ '^[A-Za-z0-9_-]+$'
    )
    AND cardinality(($1)."auditOrganizationIds") = (
      SELECT count(DISTINCT scope_id)
      FROM unnest(($1)."auditOrganizationIds") AS scope(scope_id)
    )
    AND ($1)."auditOrganizationIds" IS NOT DISTINCT FROM (
      SELECT array_agg(scope_id ORDER BY scope_id COLLATE "C")
      FROM unnest(($1)."auditOrganizationIds") AS scope(scope_id)
    )
    AND ($2)."flowId" = ($1).id
    AND ($2)."providerOperationId" = ($1).id
    AND ($2)."sendFence" >= 1;
$$;

REVOKE ALL ON FUNCTION public.password_reset_provider_correlation_source_valid(
  public.password_reset_tokens,
  public.password_reset_recoveries
) FROM PUBLIC;

-- Initial registration and migration backfill additionally require the
-- acceptance lifecycle edge to be current at the moment evidence is created.
CREATE FUNCTION public.password_reset_provider_correlation_eligible(
  token_row public.password_reset_tokens,
  recovery_row public.password_reset_recoveries
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT
    ($1)."deliveryStatus" = 'PROVIDER_ACCEPTED'
    AND public.password_reset_provider_correlation_source_valid($1, $2);
$$;

REVOKE ALL ON FUNCTION public.password_reset_provider_correlation_eligible(
  public.password_reset_tokens,
  public.password_reset_recoveries
) FROM PUBLIC;

CREATE FUNCTION public.register_password_reset_provider_correlation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  recovery_row public.password_reset_recoveries%ROWTYPE;
  exact_match boolean;
BEGIN
  IF NEW."providerCorrelationSchemaVersion" = 1
     AND NEW."deliveryStatus" = 'PROVIDER_ACCEPTED'
     AND lower(btrim(COALESCE(NEW.provider, ''))) = 'acs' THEN
    SELECT recovery.*
      INTO recovery_row
    FROM public.password_reset_recoveries recovery
    WHERE recovery."flowId" = NEW.id
    FOR KEY SHARE;

    IF NOT FOUND
       OR NOT public.password_reset_provider_correlation_eligible(NEW, recovery_row) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PASSWORD_RESET_PROVIDER_CORRELATION_INVALID';
    END IF;

    INSERT INTO public.password_reset_provider_correlations (
      "flowId",
      provider,
      "providerOperationId",
      "providerMessageId",
      "providerAcceptedAt",
      "correlationSchemaVersion"
    ) VALUES (
      NEW.id,
      NEW.provider,
      NEW."providerOperationId",
      NEW."providerMessageId",
      NEW."providerAcceptedAt",
      NEW."providerCorrelationSchemaVersion"
    )
    ON CONFLICT DO NOTHING;

    SELECT correlation."flowId" = NEW.id
           AND correlation.provider = NEW.provider
           AND correlation."providerOperationId" = NEW."providerOperationId"
           AND correlation."providerMessageId" = NEW."providerMessageId"
           AND correlation."providerAcceptedAt" = NEW."providerAcceptedAt"
           AND correlation."correlationSchemaVersion" = NEW."providerCorrelationSchemaVersion"
      INTO exact_match
    FROM public.password_reset_provider_correlations correlation
    WHERE correlation."flowId" = NEW.id;

    IF COALESCE(exact_match, false) IS NOT TRUE THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PASSWORD_RESET_PROVIDER_CORRELATION_CONFLICT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.register_password_reset_provider_correlation() FROM PUBLIC;

CREATE TRIGGER password_reset_provider_correlation_register
AFTER INSERT OR UPDATE OF
  "deliveryStatus",
  provider,
  "providerOperationId",
  "providerMessageId",
  "providerAcceptedAt",
  "providerCorrelationSchemaVersion"
ON public.password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION public.register_password_reset_provider_correlation();

CREATE FUNCTION public.prevent_password_reset_provider_correlation_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'PASSWORD_RESET_PROVIDER_CORRELATION_IMMUTABLE';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_password_reset_provider_correlation_change() FROM PUBLIC;

CREATE TRIGGER password_reset_provider_correlation_immutable
BEFORE UPDATE OR DELETE ON public.password_reset_provider_correlations
FOR EACH ROW EXECUTE FUNCTION public.prevent_password_reset_provider_correlation_change();

CREATE TRIGGER password_reset_provider_correlation_no_truncate
BEFORE TRUNCATE ON public.password_reset_provider_correlations
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_password_reset_provider_correlation_change();

CREATE FUNCTION public.prevent_registered_password_reset_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.password_reset_provider_correlations correlation
    WHERE correlation."flowId" = OLD.id
  ) AND ROW(
    NEW.token,
    NEW."userId",
    NEW."requestId",
    NEW."auditOrganizationIds",
    NEW.provider,
    NEW."providerOperationId",
    NEW."providerMessageId",
    NEW."providerAcceptedAt",
    NEW."providerCorrelationSchemaVersion"
  ) IS DISTINCT FROM ROW(
    OLD.token,
    OLD."userId",
    OLD."requestId",
    OLD."auditOrganizationIds",
    OLD.provider,
    OLD."providerOperationId",
    OLD."providerMessageId",
    OLD."providerAcceptedAt",
    OLD."providerCorrelationSchemaVersion"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PASSWORD_RESET_PROVIDER_CORRELATION_SOURCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_registered_password_reset_identity_change() FROM PUBLIC;

CREATE TRIGGER password_reset_provider_correlation_source_immutable
BEFORE UPDATE OF
  token,
  "userId",
  "requestId",
  "auditOrganizationIds",
  provider,
  "providerOperationId",
  "providerMessageId",
  "providerAcceptedAt",
  "providerCorrelationSchemaVersion"
ON public.password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_password_reset_identity_change();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.password_reset_tokens token
    LEFT JOIN public.password_reset_recoveries recovery
      ON recovery."flowId" = token.id
    WHERE token."providerCorrelationSchemaVersion" = 1
      AND token."deliveryStatus" = 'PROVIDER_ACCEPTED'
      AND (
        token.provider IS NULL
        OR token.provider = ''
        OR token.provider <> btrim(token.provider)
        OR token."providerOperationId" IS NULL
        OR token."providerMessageId" IS NULL
        OR token."providerAcceptedAt" IS NULL
        OR recovery."flowId" IS NULL
        OR (
          lower(btrim(token.provider)) = 'acs'
          AND NOT public.password_reset_provider_correlation_eligible(
            ROW(token.*)::public.password_reset_tokens,
            ROW(recovery.*)::public.password_reset_recoveries
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PASSWORD_RESET_PROVIDER_CORRELATION_BACKFILL_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.password_reset_tokens token
    JOIN public.password_reset_recoveries recovery
      ON recovery."flowId" = token.id
    WHERE public.password_reset_provider_correlation_eligible(
      ROW(token.*)::public.password_reset_tokens,
      ROW(recovery.*)::public.password_reset_recoveries
    )
    GROUP BY token.provider, token."providerMessageId"
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM public.password_reset_tokens token
    JOIN public.password_reset_recoveries recovery
      ON recovery."flowId" = token.id
    WHERE public.password_reset_provider_correlation_eligible(
      ROW(token.*)::public.password_reset_tokens,
      ROW(recovery.*)::public.password_reset_recoveries
    )
    GROUP BY token.provider, token."providerOperationId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PASSWORD_RESET_PROVIDER_CORRELATION_BACKFILL_CONFLICT';
  END IF;
END;
$$;

INSERT INTO public.password_reset_provider_correlations (
  "flowId",
  provider,
  "providerOperationId",
  "providerMessageId",
  "providerAcceptedAt",
  "correlationSchemaVersion"
)
SELECT
  token.id,
  token.provider,
  token."providerOperationId",
  token."providerMessageId",
  token."providerAcceptedAt",
  token."providerCorrelationSchemaVersion"
FROM public.password_reset_tokens token
JOIN public.password_reset_recoveries recovery
  ON recovery."flowId" = token.id
WHERE public.password_reset_provider_correlation_eligible(
  ROW(token.*)::public.password_reset_tokens,
  ROW(recovery.*)::public.password_reset_recoveries
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.password_reset_tokens token
    JOIN public.password_reset_recoveries recovery
      ON recovery."flowId" = token.id
    LEFT JOIN public.password_reset_provider_correlations correlation
      ON correlation."flowId" = token.id
    WHERE public.password_reset_provider_correlation_eligible(
      ROW(token.*)::public.password_reset_tokens,
      ROW(recovery.*)::public.password_reset_recoveries
    )
      AND (
        correlation."flowId" IS NULL
        OR correlation.provider IS DISTINCT FROM token.provider
        OR correlation."providerOperationId" IS DISTINCT FROM token."providerOperationId"
        OR correlation."providerMessageId" IS DISTINCT FROM token."providerMessageId"
        OR correlation."providerAcceptedAt" IS DISTINCT FROM token."providerAcceptedAt"
        OR correlation."correlationSchemaVersion" IS DISTINCT FROM token."providerCorrelationSchemaVersion"
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.password_reset_provider_correlations correlation
    LEFT JOIN public.password_reset_tokens token ON token.id = correlation."flowId"
    LEFT JOIN public.password_reset_recoveries recovery
      ON recovery."flowId" = correlation."flowId"
    WHERE token.id IS NULL
       OR recovery."flowId" IS NULL
       OR NOT public.password_reset_provider_correlation_source_valid(
         ROW(token.*)::public.password_reset_tokens,
         ROW(recovery.*)::public.password_reset_recoveries
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PASSWORD_RESET_PROVIDER_CORRELATION_BACKFILL_DIVERGENT';
  END IF;
END;
$$;

CREATE FUNCTION public.password_reset_provider_correlation_preflight_counts()
RETURNS TABLE (
  "eligibleAcceptedAcsRows" integer,
  "registeredCorrelationRows" integer,
  "missingCorrelationRows" integer,
  "orphanCorrelationRows" integer,
  "divergentCorrelationRows" integer,
  "invalidCorrelationRows" integer,
  "ownerMismatchRows" integer,
  "invalidFunctionPostureRows" integer,
  "missingRequiredTriggerRows" integer,
  "missingRequiredConstraintRows" integer,
  "missingRequiredIndexRows" integer,
  "unexpectedRegistryAclRows" integer,
  "unexpectedSensitiveFunctionAclRows" integer,
  "runtimeRegistryAccessRows" integer,
  "runtimeSensitiveFunctionAccessRows" integer,
  "runtimeCountFunctionDeniedRows" integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH source AS (
    SELECT token.*, recovery."flowId" AS recovery_flow_id,
           recovery."providerOperationId" AS recovery_operation_id,
           recovery."sendFence" AS recovery_send_fence,
           public.password_reset_provider_correlation_eligible(
             ROW(token.*)::public.password_reset_tokens,
             ROW(recovery.*)::public.password_reset_recoveries
           ) AS eligible,
           public.password_reset_provider_correlation_source_valid(
             ROW(token.*)::public.password_reset_tokens,
             ROW(recovery.*)::public.password_reset_recoveries
           ) AS source_valid
    FROM public.password_reset_tokens token
    LEFT JOIN public.password_reset_recoveries recovery
      ON recovery."flowId" = token.id
  )
  SELECT
    (SELECT count(*)::integer FROM source WHERE eligible) AS "eligibleAcceptedAcsRows",
    (SELECT count(*)::integer FROM public.password_reset_provider_correlations)
      AS "registeredCorrelationRows",
    (
      SELECT count(*)::integer
      FROM source
      LEFT JOIN public.password_reset_provider_correlations correlation
        ON correlation."flowId" = source.id
      WHERE source.eligible AND correlation."flowId" IS NULL
    ) AS "missingCorrelationRows",
    (
      SELECT count(*)::integer
      FROM public.password_reset_provider_correlations correlation
      LEFT JOIN source ON source.id = correlation."flowId"
      WHERE source.id IS NULL
    ) AS "orphanCorrelationRows",
    (
      SELECT count(*)::integer
      FROM public.password_reset_provider_correlations correlation
      JOIN source ON source.id = correlation."flowId"
      WHERE NOT source.source_valid
         OR correlation.provider IS DISTINCT FROM source.provider
         OR correlation."providerOperationId" IS DISTINCT FROM source."providerOperationId"
         OR correlation."providerMessageId" IS DISTINCT FROM source."providerMessageId"
         OR correlation."providerAcceptedAt" IS DISTINCT FROM source."providerAcceptedAt"
         OR correlation."correlationSchemaVersion"
              IS DISTINCT FROM source."providerCorrelationSchemaVersion"
    ) AS "divergentCorrelationRows",
    (
      SELECT count(*)::integer
      FROM public.password_reset_provider_correlations correlation
      WHERE correlation.provider <> 'acs'
         OR correlation."correlationSchemaVersion" <> 1
         OR correlation."providerOperationId" <> correlation."flowId"
         OR correlation."providerOperationId" = ''
         OR correlation."providerOperationId" <> btrim(correlation."providerOperationId")
         OR correlation."providerMessageId" = ''
         OR correlation."providerMessageId" <> btrim(correlation."providerMessageId")
    ) AS "invalidCorrelationRows",
    (
      SELECT count(*)::integer
      FROM (
        SELECT relation.oid
        FROM pg_catalog.pg_class relation
        WHERE relation.oid IN (
          'public.password_reset_recoveries'::regclass,
          'public.password_reset_provider_correlations'::regclass
        )
          AND relation.relowner <> (
            SELECT token_relation.relowner
            FROM pg_catalog.pg_class token_relation
            WHERE token_relation.oid = 'public.password_reset_tokens'::regclass
          )
        UNION ALL
        SELECT function.oid
        FROM pg_catalog.pg_proc function
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
        WHERE namespace.nspname = 'public'
          AND function.proname IN (
            'password_reset_provider_correlation_source_valid',
            'password_reset_provider_correlation_eligible',
            'register_password_reset_provider_correlation',
            'prevent_password_reset_provider_correlation_change',
            'prevent_registered_password_reset_identity_change',
            'password_reset_provider_correlation_preflight_counts'
          )
          AND function.proowner <> (
            SELECT token_relation.relowner
            FROM pg_catalog.pg_class token_relation
            WHERE token_relation.oid = 'public.password_reset_tokens'::regclass
          )
      ) owner_mismatches
    ) AS "ownerMismatchRows",
    (
      SELECT count(*)::integer
      FROM (
        WITH expected(
          signature,
          security_definer,
          volatility,
          return_type,
          returns_set,
          language_name
        ) AS (
          VALUES
            (
              'public.password_reset_provider_correlation_source_valid(public.password_reset_tokens,public.password_reset_recoveries)',
              false, 's'::"char", 'boolean'::regtype, false, 'sql'
            ),
            (
              'public.password_reset_provider_correlation_eligible(public.password_reset_tokens,public.password_reset_recoveries)',
              false, 's'::"char", 'boolean'::regtype, false, 'sql'
            ),
            (
              'public.register_password_reset_provider_correlation()',
              true, 'v'::"char", 'trigger'::regtype, false, 'plpgsql'
            ),
            (
              'public.prevent_password_reset_provider_correlation_change()',
              false, 'v'::"char", 'trigger'::regtype, false, 'plpgsql'
            ),
            (
              'public.prevent_registered_password_reset_identity_change()',
              true, 'v'::"char", 'trigger'::regtype, false, 'plpgsql'
            ),
            (
              'public.password_reset_provider_correlation_preflight_counts()',
              true, 's'::"char", 'record'::regtype, true, 'sql'
            )
        )
        SELECT expected.signature
        FROM expected
        LEFT JOIN pg_catalog.pg_proc function
          ON function.oid = pg_catalog.to_regprocedure(expected.signature)
        LEFT JOIN pg_catalog.pg_language language ON language.oid = function.prolang
        WHERE function.oid IS NULL
           OR function.prokind <> 'f'
           OR function.prosecdef IS DISTINCT FROM expected.security_definer
           OR function.provolatile IS DISTINCT FROM expected.volatility
           OR function.prorettype IS DISTINCT FROM expected.return_type
           OR function.proretset IS DISTINCT FROM expected.returns_set
           OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
           OR language.lanname IS DISTINCT FROM expected.language_name
        UNION ALL
        SELECT function.oid::text
        FROM pg_catalog.pg_proc function
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
        WHERE namespace.nspname = 'public'
          AND function.proname IN (
            'password_reset_provider_correlation_source_valid',
            'password_reset_provider_correlation_eligible',
            'register_password_reset_provider_correlation',
            'prevent_password_reset_provider_correlation_change',
            'prevent_registered_password_reset_identity_change',
            'password_reset_provider_correlation_preflight_counts'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM expected
            WHERE pg_catalog.to_regprocedure(expected.signature) = function.oid
          )
      ) invalid_functions
    ) AS "invalidFunctionPostureRows",
    (
      SELECT (4 - count(*))::integer
      FROM pg_catalog.pg_trigger trigger
      JOIN pg_catalog.pg_proc function ON function.oid = trigger.tgfoid
      WHERE NOT trigger.tgisinternal
        AND trigger.tgenabled IN ('O', 'A')
        AND (
          (trigger.tgrelid = 'public.password_reset_tokens'::regclass
           AND trigger.tgname = 'password_reset_provider_correlation_register'
           AND function.oid =
             'public.register_password_reset_provider_correlation()'::regprocedure
           AND trigger.tgtype = 21
           AND pg_catalog.pg_get_triggerdef(trigger.oid, true) LIKE
             '%AFTER INSERT OR UPDATE OF "deliveryStatus", provider, "providerOperationId", "providerMessageId", "providerAcceptedAt", "providerCorrelationSchemaVersion"%')
          OR (trigger.tgrelid = 'public.password_reset_tokens'::regclass
              AND trigger.tgname = 'password_reset_provider_correlation_source_immutable'
              AND function.oid =
                'public.prevent_registered_password_reset_identity_change()'::regprocedure
              AND trigger.tgtype = 19
              AND pg_catalog.pg_get_triggerdef(trigger.oid, true) LIKE
                '%BEFORE UPDATE OF token, "userId", "requestId", "auditOrganizationIds", provider, "providerOperationId", "providerMessageId", "providerAcceptedAt", "providerCorrelationSchemaVersion"%')
          OR (trigger.tgrelid = 'public.password_reset_provider_correlations'::regclass
              AND trigger.tgname = 'password_reset_provider_correlation_immutable'
              AND function.oid =
                'public.prevent_password_reset_provider_correlation_change()'::regprocedure
              AND trigger.tgtype = 27)
          OR (trigger.tgrelid = 'public.password_reset_provider_correlations'::regclass
              AND trigger.tgname = 'password_reset_provider_correlation_no_truncate'
              AND function.oid =
                'public.prevent_password_reset_provider_correlation_change()'::regprocedure
              AND trigger.tgtype = 34)
        )
    ) AS "missingRequiredTriggerRows",
    (
      SELECT (7 - count(*))::integer
      FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'public.password_reset_provider_correlations'::regclass
        AND constraint_row.convalidated
        AND (
          (constraint_row.conname = 'password_reset_provider_correlations_pkey'
           AND constraint_row.contype = 'p'
           AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) = 'PRIMARY KEY ("flowId")')
          OR (constraint_row.conname = 'password_reset_provider_correlations_provider_check'
              AND constraint_row.contype = 'c'
              AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
                'CHECK (provider::text = ''acs''::text)')
          OR (constraint_row.conname = 'password_reset_provider_correlations_contract_check'
              AND constraint_row.contype = 'c'
              AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
                'CHECK ("correlationSchemaVersion" = 1)')
          OR (constraint_row.conname = 'password_reset_provider_correlations_operation_flow_check'
              AND constraint_row.contype = 'c'
              AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
                'CHECK ("providerOperationId"::text = "flowId")')
          OR (constraint_row.conname = 'password_reset_provider_correlations_identifier_shape_check'
              AND constraint_row.contype = 'c'
              AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
                'CHECK ("providerOperationId"::text <> ''''::text AND "providerOperationId"::text = btrim("providerOperationId"::text) AND "providerMessageId"::text <> ''''::text AND "providerMessageId"::text = btrim("providerMessageId"::text))')
          OR (constraint_row.conname = 'password_reset_provider_correlations_token_fkey'
              AND constraint_row.contype = 'f'
              AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY ("flowId") REFERENCES public.password_reset_tokens(id) ON UPDATE RESTRICT ON DELETE RESTRICT')
          OR (constraint_row.conname = 'password_reset_provider_correlations_recovery_fkey'
              AND constraint_row.contype = 'f'
              AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
                'FOREIGN KEY ("flowId", "providerOperationId") REFERENCES public.password_reset_recoveries("flowId", "providerOperationId") ON UPDATE RESTRICT ON DELETE RESTRICT')
        )
    ) AS "missingRequiredConstraintRows",
    (
      SELECT (5 - count(*))::integer
      FROM pg_catalog.pg_class index_relation
      JOIN pg_catalog.pg_index index ON index.indexrelid = index_relation.oid
      WHERE index.indrelid = 'public.password_reset_provider_correlations'::regclass
        AND index.indisvalid
        AND index.indisready
        AND index.indislive
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute attribute
          WHERE attribute.attrelid = 'public.password_reset_provider_correlations'::regclass
            AND attribute.attname IN ('provider', 'providerOperationId', 'providerMessageId')
            AND attribute.attcollation <> 'pg_catalog."C"'::regcollation
        )
        AND (
          (index_relation.relname = 'password_reset_provider_correlations_pkey'
           AND index.indisunique
           AND pg_catalog.pg_get_indexdef(index_relation.oid) =
             'CREATE UNIQUE INDEX password_reset_provider_correlations_pkey ON public.password_reset_provider_correlations USING btree ("flowId")')
          OR (index_relation.relname = 'password_reset_provider_correlations_provider_operation_key'
              AND index.indisunique
              AND pg_catalog.pg_get_indexdef(index_relation.oid) =
                'CREATE UNIQUE INDEX password_reset_provider_correlations_provider_operation_key ON public.password_reset_provider_correlations USING btree (provider, "providerOperationId")')
          OR (index_relation.relname = 'password_reset_provider_correlations_flow_operation_key'
              AND index.indisunique
              AND pg_catalog.pg_get_indexdef(index_relation.oid) =
                'CREATE UNIQUE INDEX password_reset_provider_correlations_flow_operation_key ON public.password_reset_provider_correlations USING btree ("flowId", "providerOperationId")')
          OR (index_relation.relname = 'password_reset_provider_correlations_provider_message_key'
              AND index.indisunique
              AND pg_catalog.pg_get_indexdef(index_relation.oid) =
                'CREATE UNIQUE INDEX password_reset_provider_correlations_provider_message_key ON public.password_reset_provider_correlations USING btree (provider, "providerMessageId")')
          OR (index_relation.relname = 'password_reset_provider_correlations_recorded_idx'
              AND NOT index.indisunique
              AND pg_catalog.pg_get_indexdef(index_relation.oid) =
                'CREATE INDEX password_reset_provider_correlations_recorded_idx ON public.password_reset_provider_correlations USING btree ("recordedAt")')
        )
    ) AS "missingRequiredIndexRows",
    (
      SELECT count(*)::integer
      FROM pg_catalog.pg_class relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) acl
      WHERE relation.oid = 'public.password_reset_provider_correlations'::regclass
        AND acl.grantee <> relation.relowner
    ) AS "unexpectedRegistryAclRows",
    (
      SELECT count(*)::integer
      FROM pg_catalog.pg_proc function
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
      ) acl
      WHERE namespace.nspname = 'public'
        AND function.proname IN (
          'password_reset_provider_correlation_source_valid',
          'password_reset_provider_correlation_eligible',
          'register_password_reset_provider_correlation',
          'prevent_password_reset_provider_correlation_change',
          'prevent_registered_password_reset_identity_change',
          'password_reset_provider_correlation_preflight_counts'
        )
        AND acl.grantee <> function.proowner
        AND (
          function.oid IS DISTINCT FROM
            'public.password_reset_provider_correlation_preflight_counts()'::regprocedure
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
          OR acl.grantee IS DISTINCT FROM (
            SELECT role.oid
            FROM pg_catalog.pg_roles role
            WHERE role.rolname = session_user
          )
        )
    ) AS "unexpectedSensitiveFunctionAclRows",
    (
      SELECT CASE WHEN pg_catalog.has_table_privilege(
        session_user,
        'public.password_reset_provider_correlations',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) THEN 1 ELSE 0 END
    ) AS "runtimeRegistryAccessRows",
    (
      SELECT count(*)::integer
      FROM pg_catalog.pg_proc function
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
      WHERE namespace.nspname = 'public'
        AND function.proname IN (
          'password_reset_provider_correlation_source_valid',
          'password_reset_provider_correlation_eligible',
          'register_password_reset_provider_correlation',
          'prevent_password_reset_provider_correlation_change',
          'prevent_registered_password_reset_identity_change',
          'password_reset_provider_correlation_preflight_counts'
        )
        AND function.oid IS DISTINCT FROM
          'public.password_reset_provider_correlation_preflight_counts()'::regprocedure
        AND pg_catalog.has_function_privilege(session_user, function.oid, 'EXECUTE')
    ) AS "runtimeSensitiveFunctionAccessRows",
    (
      SELECT CASE WHEN pg_catalog.has_function_privilege(
        session_user,
        'public.password_reset_provider_correlation_preflight_counts()'::regprocedure,
        'EXECUTE'
      ) THEN 0 ELSE 1 END
    ) AS "runtimeCountFunctionDeniedRows";
$$;

-- Neutralize installation-specific ALTER DEFAULT PRIVILEGES rules. The
-- protected functions must never inherit executable access for runtime,
-- ingress, reporting, or other non-owner roles.
DO $$
DECLARE
  granted_function record;
BEGIN
  FOR granted_function IN
    SELECT DISTINCT
      namespace.nspname AS schema_name,
      function.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
      grantee.rolname AS grantee_name
    FROM pg_catalog.pg_proc function
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) acl
    JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND function.proname IN (
        'password_reset_provider_correlation_source_valid',
        'password_reset_provider_correlation_eligible',
        'register_password_reset_provider_correlation',
        'prevent_password_reset_provider_correlation_change',
        'prevent_registered_password_reset_identity_change',
        'password_reset_provider_correlation_preflight_counts'
      )
      AND acl.grantee <> function.proowner
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM %I',
      granted_function.schema_name,
      granted_function.function_name,
      granted_function.identity_arguments,
      granted_function.grantee_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.password_reset_provider_correlation_preflight_counts() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vaultspace_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.password_reset_provider_correlation_preflight_counts() TO vaultspace_app';
  END IF;
END;
$$;

COMMIT;
