-- The ingress role historically had table-level UPDATE. Freeze receipt writers
-- while proving that no unapproved projector state has already been persisted
-- and while replacing the trigger boundary atomically.
-- Keep every operational statement in this one top-level DO. Prisma 5.22 can
-- otherwise replace an intentional P0001 with a later 25P02 from an already
-- aborted migration transaction, losing the actionable guard category.
DO $migration$
DECLARE
  migration_cutoff timestamp(3);
  granted_role record;
  expected_function oid;
  expected_owner oid;
  expected_current_user oid;
  expected_trigger_definition text :=
    'CREATE TRIGGER provider_event_evidence_immutable BEFORE INSERT OR UPDATE ON public.provider_event_inbox FOR EACH ROW EXECUTE FUNCTION prevent_provider_event_evidence_change()';
BEGIN
  -- `lock_timeout` is set before the lock request. The deployment runbook must
  -- establish both this and the 120-second statement timeout before Prisma
  -- submits this single statement, because a statement timeout set here cannot
  -- retroactively bound the enclosing DO command.
  PERFORM pg_catalog.set_config('lock_timeout', '10s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '120s', true);

  LOCK TABLE public.provider_event_inbox IN ACCESS EXCLUSIVE MODE;
  migration_cutoff := pg_catalog.clock_timestamp()::timestamp(3);

  IF EXISTS (
    SELECT 1
    FROM public.provider_event_inbox inbox
    CROSS JOIN LATERAL (
      SELECT pg_catalog.array_remove(
        ARRAY[
          CASE
            WHEN inbox."providerMessageId" IS NULL
            THEN 'PROVIDER_MESSAGE_ID_MISSING'
          END,
          CASE
            WHEN inbox."providerStatus" IS NULL
            THEN CASE
              WHEN inbox."quarantineReasonCodes" @>
                ARRAY['PROVIDER_STATUS_UNSUPPORTED']::varchar(100)[]
              THEN 'PROVIDER_STATUS_UNSUPPORTED'
              ELSE 'PROVIDER_STATUS_MISSING'
            END
          END,
          CASE
            WHEN inbox."dataVersion" <> '1.0' OR inbox."metadataVersion" <> '1'
            THEN 'EVENT_GRID_VERSION_UNSUPPORTED'
          END
        ]::varchar(100)[],
        NULL
      ) AS expected_reasons
    ) normalized
    WHERE (
      inbox."createdAt" = inbox."receivedAt"
      AND inbox."nextProcessingAt" = inbox."receivedAt"
      AND inbox."createdAt" <= migration_cutoff
      AND inbox."receivedAt" <= migration_cutoff
      AND inbox."nextProcessingAt" <= migration_cutoff
      AND inbox."updatedAt" <= migration_cutoff
      AND inbox."processingAttempts" = 0
      AND inbox."processingLeaseId" IS NULL
      AND inbox."processingLeaseExpiresAt" IS NULL
      AND inbox."processedAt" IS NULL
      AND inbox."quarantineReasonCodes" = normalized.expected_reasons
      AND (
        (
          inbox."processingStatus" = 'PENDING'
          AND pg_catalog.cardinality(normalized.expected_reasons) = 0
          AND inbox."lastErrorCode" IS NULL
          AND inbox."conflictCount" = 0
          AND inbox."firstConflictAt" IS NULL
          AND inbox."conflictingPayloadFingerprint" IS NULL
          AND inbox."lastConflictAt" IS NULL
          AND inbox."lastConflictingPayloadFingerprint" IS NULL
        )
        OR (
          inbox."processingStatus" = 'QUARANTINED'
          AND pg_catalog.cardinality(normalized.expected_reasons) > 0
          AND inbox."lastErrorCode" = normalized.expected_reasons[1]
          AND inbox."conflictCount" = 0
          AND inbox."firstConflictAt" IS NULL
          AND inbox."conflictingPayloadFingerprint" IS NULL
          AND inbox."lastConflictAt" IS NULL
          AND inbox."lastConflictingPayloadFingerprint" IS NULL
        )
        OR (
          inbox."processingStatus" = 'CONFLICT'
          AND inbox."lastErrorCode" = 'EVENT_ID_PAYLOAD_CONFLICT'
          AND inbox."conflictCount" > 0
          AND inbox."firstConflictAt" IS NOT NULL
          AND inbox."conflictingPayloadFingerprint" IS NOT NULL
          AND inbox."conflictingPayloadFingerprint" <> inbox."payloadFingerprint"
          AND inbox."lastConflictAt" IS NOT NULL
          AND inbox."firstConflictAt" >= inbox."receivedAt"
          AND inbox."lastConflictAt" >= inbox."firstConflictAt"
          AND inbox."firstConflictAt" <= migration_cutoff
          AND inbox."lastConflictAt" <= migration_cutoff
          AND inbox."updatedAt" >= inbox."lastConflictAt"
          AND inbox."lastConflictingPayloadFingerprint" IS NOT NULL
          AND inbox."lastConflictingPayloadFingerprint" <> inbox."payloadFingerprint"
          AND (
            inbox."conflictCount" <> 1
            OR (
              inbox."firstConflictAt" = inbox."lastConflictAt"
              AND inbox."conflictingPayloadFingerprint" =
                inbox."lastConflictingPayloadFingerprint"
            )
          )
        )
      )
    ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_INBOX_PREEXISTING_STATE_INVALID';
  END IF;

CREATE OR REPLACE FUNCTION public.prevent_provider_event_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
DECLARE
  caller_is_exact_table_owner boolean := false;
  observed_at timestamp(3);
  expected_quarantine_reasons varchar(100)[] := ARRAY[]::varchar(100)[];
BEGIN
  SELECT relation.relowner = caller_role.oid
    INTO caller_is_exact_table_owner
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_roles caller_role ON caller_role.rolname = CURRENT_USER
  WHERE relation.oid = TG_RELID;

  caller_is_exact_table_owner :=
    COALESCE(caller_is_exact_table_owner, false);

  IF TG_OP = 'INSERT' THEN
    IF caller_is_exact_table_owner IS NOT TRUE THEN
      IF NEW."providerMessageId" IS NULL THEN
        expected_quarantine_reasons := pg_catalog.array_append(
          expected_quarantine_reasons,
          'PROVIDER_MESSAGE_ID_MISSING'::varchar(100)
        );
      END IF;
      IF NEW."providerStatus" IS NULL THEN
        expected_quarantine_reasons := pg_catalog.array_append(
          expected_quarantine_reasons,
          CASE
            WHEN NEW."quarantineReasonCodes" @>
              ARRAY['PROVIDER_STATUS_UNSUPPORTED']::varchar(100)[]
            THEN 'PROVIDER_STATUS_UNSUPPORTED'::varchar(100)
            ELSE 'PROVIDER_STATUS_MISSING'::varchar(100)
          END
        );
      END IF;
      IF NEW."dataVersion" <> '1.0' OR NEW."metadataVersion" <> '1' THEN
        expected_quarantine_reasons := pg_catalog.array_append(
          expected_quarantine_reasons,
          'EVENT_GRID_VERSION_UNSUPPORTED'::varchar(100)
        );
      END IF;

      IF NEW."processingAttempts" IS DISTINCT FROM 0
         OR NEW."processingLeaseId" IS NOT NULL
         OR NEW."processingLeaseExpiresAt" IS NOT NULL
         OR NEW."processedAt" IS NOT NULL
         OR NEW."conflictCount" IS DISTINCT FROM 0
         OR NEW."firstConflictAt" IS NOT NULL
         OR NEW."conflictingPayloadFingerprint" IS NOT NULL
         OR NEW."lastConflictAt" IS NOT NULL
         OR NEW."lastConflictingPayloadFingerprint" IS NOT NULL
         OR NEW."quarantineReasonCodes" IS DISTINCT FROM expected_quarantine_reasons
         OR (
           (
             NEW."processingStatus" IS NOT DISTINCT FROM 'PENDING'
             AND pg_catalog.cardinality(expected_quarantine_reasons) = 0
             AND NEW."lastErrorCode" IS NULL
           )
           OR (
             NEW."processingStatus" IS NOT DISTINCT FROM 'QUARANTINED'
             AND pg_catalog.cardinality(expected_quarantine_reasons) > 0
             AND NEW."lastErrorCode" IS NOT DISTINCT FROM
               expected_quarantine_reasons[1]
           )
         ) IS NOT TRUE THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'PROVIDER_EVENT_INGRESS_INITIAL_STATE_INVALID';
      END IF;

      observed_at := pg_catalog.clock_timestamp()::timestamp(3);
      NEW."createdAt" := observed_at;
      NEW."receivedAt" := observed_at;
      NEW."updatedAt" := observed_at;
      NEW."nextProcessingAt" := observed_at;
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    NEW."id", NEW."provider", NEW."eventType", NEW."eventIdFingerprint",
    NEW."payloadFingerprint", NEW."payloadFingerprintKeyId", NEW."topicFingerprint",
    NEW."providerMessageId", NEW."providerStatus", NEW."dataVersion",
    NEW."metadataVersion", NEW."eventAt", NEW."deliveryAttemptAt", NEW."receivedAt",
    NEW."createdAt", NEW."quarantineReasonCodes"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."provider", OLD."eventType", OLD."eventIdFingerprint",
    OLD."payloadFingerprint", OLD."payloadFingerprintKeyId", OLD."topicFingerprint",
    OLD."providerMessageId", OLD."providerStatus", OLD."dataVersion",
    OLD."metadataVersion", OLD."eventAt", OLD."deliveryAttemptAt", OLD."receivedAt",
    OLD."createdAt", OLD."quarantineReasonCodes"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_FIRST_SEEN_EVIDENCE_IMMUTABLE';
  END IF;

  IF OLD."processingStatus" IS NOT DISTINCT FROM 'CONFLICT'
     AND NEW."processingStatus" IS DISTINCT FROM 'CONFLICT' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_CONFLICT_TERMINAL';
  END IF;

  IF NEW."processingStatus" IS NOT DISTINCT FROM 'CONFLICT'
     AND NEW."lastErrorCode" IS DISTINCT FROM 'EVENT_ID_PAYLOAD_CONFLICT' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_CONFLICT_MONOTONICITY_INVALID';
  END IF;

  IF OLD."firstConflictAt" IS NOT NULL
     AND ROW(
       NEW."firstConflictAt", NEW."conflictingPayloadFingerprint"
     ) IS DISTINCT FROM ROW(
       OLD."firstConflictAt", OLD."conflictingPayloadFingerprint"
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_FIRST_CONFLICT_IMMUTABLE';
  END IF;

  -- A terminal conflict is either an exact no-op or one new, fully-formed
  -- conflict observation. No processor or maintenance state can be changed
  -- while leaving its observation count unchanged.
  IF OLD."processingStatus" IS NOT DISTINCT FROM 'CONFLICT'
     AND NEW."conflictCount" IS NOT DISTINCT FROM OLD."conflictCount" THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PROVIDER_EVENT_CONFLICT_TERMINAL';
    END IF;
    RETURN NEW;
  END IF;

  IF caller_is_exact_table_owner IS NOT TRUE THEN
    IF NEW."conflictCount" IS DISTINCT FROM OLD."conflictCount" + 1
       OR NEW."processingStatus" IS DISTINCT FROM 'CONFLICT'
       OR NEW."lastErrorCode" IS DISTINCT FROM 'EVENT_ID_PAYLOAD_CONFLICT'
       OR NEW."processingLeaseId" IS NOT NULL
       OR NEW."processingLeaseExpiresAt" IS NOT NULL
       OR NEW."lastConflictingPayloadFingerprint" IS NULL
       OR NEW."lastConflictingPayloadFingerprint" !~ '^[0-9a-f]{64}$'
       OR NEW."lastConflictingPayloadFingerprint" IS NOT DISTINCT FROM
         OLD."payloadFingerprint"
       OR NEW."processingAttempts" IS DISTINCT FROM OLD."processingAttempts"
       OR NEW."nextProcessingAt" IS DISTINCT FROM OLD."nextProcessingAt"
       OR NEW."processedAt" IS DISTINCT FROM OLD."processedAt"
       OR (
         OLD."processingStatus" IS NOT DISTINCT FROM 'CONFLICT'
         AND (
           NEW."processingAttempts" IS DISTINCT FROM OLD."processingAttempts"
           OR NEW."nextProcessingAt" IS DISTINCT FROM OLD."nextProcessingAt"
           OR NEW."processedAt" IS DISTINCT FROM OLD."processedAt"
         )
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PROVIDER_EVENT_CONFLICT_INTENT_INVALID';
    END IF;

    observed_at := pg_catalog.clock_timestamp()::timestamp(3);
    NEW."processingStatus" := 'CONFLICT';
    NEW."lastErrorCode" := 'EVENT_ID_PAYLOAD_CONFLICT';
    NEW."processingLeaseId" := NULL;
    NEW."processingLeaseExpiresAt" := NULL;
    IF OLD."firstConflictAt" IS NULL THEN
      NEW."firstConflictAt" := observed_at;
      NEW."conflictingPayloadFingerprint" := NEW."lastConflictingPayloadFingerprint";
    END IF;
    NEW."lastConflictAt" := GREATEST(OLD."lastConflictAt", observed_at);
    NEW."updatedAt" := GREATEST(OLD."updatedAt", observed_at);
    RETURN NEW;
  END IF;

  IF NEW."conflictCount" IS DISTINCT FROM OLD."conflictCount" THEN
    IF NEW."conflictCount" IS DISTINCT FROM OLD."conflictCount" + 1
       OR NEW."processingStatus" IS DISTINCT FROM 'CONFLICT'
       OR NEW."lastErrorCode" IS DISTINCT FROM 'EVENT_ID_PAYLOAD_CONFLICT'
       OR NEW."processingLeaseId" IS NOT NULL
       OR NEW."processingLeaseExpiresAt" IS NOT NULL
       OR NEW."lastConflictAt" IS NULL
       OR NEW."lastConflictingPayloadFingerprint" IS NULL
       OR NEW."lastConflictingPayloadFingerprint" !~ '^[0-9a-f]{64}$'
       OR NEW."lastConflictingPayloadFingerprint" IS NOT DISTINCT FROM
         OLD."payloadFingerprint"
       OR NEW."processingAttempts" IS DISTINCT FROM OLD."processingAttempts"
       OR NEW."nextProcessingAt" IS DISTINCT FROM OLD."nextProcessingAt"
       OR NEW."processedAt" IS DISTINCT FROM OLD."processedAt"
       OR NEW."updatedAt" IS NULL
       OR NEW."updatedAt" < OLD."updatedAt"
       OR (
         OLD."lastConflictAt" IS NOT NULL
         AND NEW."lastConflictAt" < OLD."lastConflictAt"
       )
       OR (
         OLD."firstConflictAt" IS NULL
         AND (
           NEW."firstConflictAt" IS NULL
           OR NEW."conflictingPayloadFingerprint" IS NULL
           OR NEW."conflictingPayloadFingerprint" IS DISTINCT FROM
             NEW."lastConflictingPayloadFingerprint"
           OR NEW."conflictingPayloadFingerprint" IS NOT DISTINCT FROM
             OLD."payloadFingerprint"
         )
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PROVIDER_EVENT_CONFLICT_MONOTONICITY_INVALID';
    END IF;
  ELSIF ROW(
    NEW."firstConflictAt", NEW."conflictingPayloadFingerprint",
    NEW."lastConflictAt", NEW."lastConflictingPayloadFingerprint"
  ) IS DISTINCT FROM ROW(
    OLD."firstConflictAt", OLD."conflictingPayloadFingerprint",
    OLD."lastConflictAt", OLD."lastConflictingPayloadFingerprint"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_CONFLICT_MONOTONICITY_INVALID';
  END IF;

  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION public.prevent_provider_event_evidence_change() FROM PUBLIC;
  FOR granted_role IN
    SELECT DISTINCT acl.grantee AS grantee_oid, grantee.rolname AS grantee_name
    FROM pg_catalog.pg_proc function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    WHERE function.oid =
      'public.prevent_provider_event_evidence_change()'::pg_catalog.regprocedure
      AND acl.grantee <> function.proowner
  LOOP
    IF granted_role.grantee_oid = 0 THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.prevent_provider_event_evidence_change() FROM PUBLIC';
    ELSE
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION public.prevent_provider_event_evidence_change() FROM %I',
        granted_role.grantee_name
      );
    END IF;
  END LOOP;

DROP TRIGGER provider_event_evidence_immutable ON public.provider_event_inbox;
CREATE TRIGGER provider_event_evidence_immutable
BEFORE INSERT OR UPDATE ON public.provider_event_inbox
FOR EACH ROW EXECUTE FUNCTION public.prevent_provider_event_evidence_change();

  expected_function :=
    'public.prevent_provider_event_evidence_change()'::pg_catalog.regprocedure;

  SELECT relation.relowner INTO expected_owner
  FROM pg_catalog.pg_class relation
  WHERE relation.oid = 'public.provider_event_inbox'::pg_catalog.regclass;

  SELECT role.oid INTO expected_current_user
  FROM pg_catalog.pg_roles role
  WHERE role.rolname = CURRENT_USER;

  IF expected_owner IS NULL
     OR expected_current_user IS NULL
     OR expected_owner <> expected_current_user
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class relation
       WHERE relation.oid = 'public.provider_event_inbox'::pg_catalog.regclass
         AND relation.relkind = 'r'
         AND NOT relation.relispartition
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_proc function
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname = 'public'
         AND function.proname = 'prevent_provider_event_evidence_change'
     ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc function
       JOIN pg_catalog.pg_language language ON language.oid = function.prolang
       WHERE function.oid = expected_function
         AND function.proowner = expected_current_user
         AND function.prosecdef = false
         AND function.provolatile = 'v'
         AND function.proretset = false
         AND function.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
         AND language.lanname = 'plpgsql'
         AND function.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND function.prosrc LIKE '%PROVIDER_EVENT_INGRESS_INITIAL_STATE_INVALID%'
         AND function.prosrc LIKE '%PROVIDER_EVENT_CONFLICT_INTENT_INVALID%'
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
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class relation
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
       ) acl
       WHERE relation.oid = 'public.provider_event_inbox'::pg_catalog.regclass
         AND acl.grantee <> relation.relowner
         AND (
           acl.grantee = 0
           OR acl.is_grantable
           OR acl.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE')
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute attribute
       JOIN pg_catalog.pg_class relation ON relation.oid = attribute.attrelid
       CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
       WHERE attribute.attrelid = 'public.provider_event_inbox'::pg_catalog.regclass
         AND attribute.attacl IS NOT NULL
         AND NOT attribute.attisdropped
         AND acl.grantee <> relation.relowner
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger trigger
       WHERE trigger.tgrelid = 'public.provider_event_inbox'::pg_catalog.regclass
         AND trigger.tgname = 'provider_event_evidence_immutable'
         AND trigger.tgfoid = expected_function
         AND trigger.tgenabled = 'O'
         AND trigger.tgtype = 23
         AND NOT trigger.tgisinternal
         AND pg_catalog.pg_get_triggerdef(trigger.oid) = expected_trigger_definition
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger trigger
       WHERE trigger.tgrelid = 'public.provider_event_inbox'::pg_catalog.regclass
         AND NOT trigger.tgisinternal
         AND (
           trigger.tgname <> 'provider_event_evidence_immutable'
           OR trigger.tgfoid <> expected_function
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger trigger
       WHERE trigger.tgfoid = expected_function
         AND NOT trigger.tgisinternal
         AND trigger.tgrelid <> 'public.provider_event_inbox'::pg_catalog.regclass
     )
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           (
             'provider_event_inbox_provider_check',
             $constraint$CHECK (provider::text = 'acs'::text)$constraint$
           ),
           (
             'provider_event_inbox_provider_status_check',
             $constraint$CHECK ("providerStatus" IS NULL OR ("providerStatus"::text = ANY (ARRAY['Delivered'::character varying, 'Suppressed'::character varying, 'Bounced'::character varying, 'Quarantined'::character varying, 'FilteredSpam'::character varying, 'Expanded'::character varying, 'Failed'::character varying]::text[])))$constraint$
           ),
           (
             'provider_event_inbox_fingerprints_check',
             $constraint$CHECK ("eventIdFingerprint"::text ~ '^[0-9a-f]{64}$'::text AND "payloadFingerprint"::text ~ '^[0-9a-f]{64}$'::text AND "topicFingerprint"::text ~ '^[0-9a-f]{64}$'::text AND ("conflictingPayloadFingerprint" IS NULL OR "conflictingPayloadFingerprint"::text ~ '^[0-9a-f]{64}$'::text) AND ("lastConflictingPayloadFingerprint" IS NULL OR "lastConflictingPayloadFingerprint"::text ~ '^[0-9a-f]{64}$'::text))$constraint$
           ),
           (
             'provider_event_inbox_processing_status_check',
             $constraint$CHECK ("processingStatus"::text = ANY (ARRAY['PENDING'::character varying, 'QUARANTINED'::character varying, 'PROCESSING'::character varying, 'PROCESSED'::character varying, 'CONFLICT'::character varying]::text[]))$constraint$
           ),
           (
             'provider_event_inbox_attempts_check',
             $constraint$CHECK ("processingAttempts" >= 0)$constraint$
           ),
           (
             'provider_event_inbox_quarantine_reasons_check',
             $constraint$CHECK (cardinality("quarantineReasonCodes") <= 4 AND "quarantineReasonCodes" <@ ARRAY['PROVIDER_MESSAGE_ID_MISSING'::character varying(100), 'PROVIDER_STATUS_MISSING'::character varying(100), 'PROVIDER_STATUS_UNSUPPORTED'::character varying(100), 'EVENT_GRID_VERSION_UNSUPPORTED'::character varying(100)] AND (("processingStatus"::text = 'QUARANTINED'::text) = (cardinality("quarantineReasonCodes") > 0) OR "processingStatus"::text = 'CONFLICT'::text))$constraint$
           ),
           (
             'provider_event_inbox_conflict_state_check',
             $constraint$CHECK ("processingStatus"::text <> 'CONFLICT'::text AND "conflictCount" = 0 AND "firstConflictAt" IS NULL AND "conflictingPayloadFingerprint" IS NULL AND "lastConflictAt" IS NULL AND "lastConflictingPayloadFingerprint" IS NULL OR "processingStatus"::text = 'CONFLICT'::text AND "conflictCount" > 0 AND "firstConflictAt" IS NOT NULL AND "conflictingPayloadFingerprint" IS NOT NULL AND "lastConflictAt" IS NOT NULL AND "lastConflictingPayloadFingerprint" IS NOT NULL AND "lastConflictAt" >= "firstConflictAt")$constraint$
           ),
           (
             'provider_event_inbox_lease_check',
             $constraint$CHECK (("processingLeaseId" IS NULL) = ("processingLeaseExpiresAt" IS NULL))$constraint$
           ),
           (
             'provider_event_inbox_processing_lease_state_check',
             $constraint$CHECK (("processingStatus"::text = 'PROCESSING'::text) = ("processingLeaseId" IS NOT NULL))$constraint$
           ),
           (
             'provider_event_inbox_processed_state_check',
             $constraint$CHECK (("processingStatus"::text <> 'PROCESSED'::text OR "processedAt" IS NOT NULL) AND ("processedAt" IS NULL OR ("processingStatus"::text = ANY (ARRAY['PROCESSED'::character varying, 'CONFLICT'::character varying]::text[]))))$constraint$
           )
       ) required(name, definition)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_constraint constraint_row
         WHERE constraint_row.conrelid = 'public.provider_event_inbox'::pg_catalog.regclass
           AND constraint_row.conname = required.name
           AND constraint_row.contype = 'c'
           AND constraint_row.convalidated
           AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
             required.definition
       )
     )
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           ('id'),
           ('createdAt'),
           ('updatedAt'),
           ('provider'),
           ('eventType'),
           ('eventIdFingerprint'),
           ('payloadFingerprint'),
           ('payloadFingerprintKeyId'),
           ('topicFingerprint'),
           ('dataVersion'),
           ('metadataVersion'),
           ('eventAt'),
           ('receivedAt'),
           ('processingStatus'),
           ('processingAttempts'),
           ('nextProcessingAt'),
           ('quarantineReasonCodes'),
           ('conflictCount')
       ) required(name)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_attribute attribute
         WHERE attribute.attrelid = 'public.provider_event_inbox'::pg_catalog.regclass
           AND attribute.attname = required.name
           AND attribute.attnotnull
           AND NOT attribute.attisdropped
       )
     )
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           ('processingAttempts', '0'),
           ('conflictCount', '0'),
           (
             'quarantineReasonCodes',
             '(ARRAY[]::character varying[])::character varying(100)[]'
           )
       ) required(name, definition)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_attribute attribute
         JOIN pg_catalog.pg_attrdef default_value
           ON default_value.adrelid = attribute.attrelid
          AND default_value.adnum = attribute.attnum
         WHERE attribute.attrelid = 'public.provider_event_inbox'::pg_catalog.regclass
           AND attribute.attname = required.name
           AND attribute.atthasdef
           AND NOT attribute.attisdropped
           AND pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) =
             required.definition
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PROVIDER_EVENT_INBOX_OWNERSHIP_POSTURE_INVALID';
  END IF;
END;
$migration$;
