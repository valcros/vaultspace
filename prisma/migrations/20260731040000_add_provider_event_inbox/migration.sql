BEGIN;

CREATE TABLE "provider_event_inbox" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "eventType" VARCHAR(100) NOT NULL,
  "eventIdFingerprint" VARCHAR(64) NOT NULL,
  "payloadFingerprint" VARCHAR(64) NOT NULL,
  "payloadFingerprintKeyId" VARCHAR(64) NOT NULL,
  "topicFingerprint" VARCHAR(64) NOT NULL,
  "providerMessageId" VARCHAR(255),
  "providerStatus" VARCHAR(32),
  "dataVersion" VARCHAR(16) NOT NULL,
  "metadataVersion" VARCHAR(16) NOT NULL,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "deliveryAttemptAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStatus" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextProcessingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingLeaseId" VARCHAR(64),
  "processingLeaseExpiresAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(100),
  "quarantineReasonCodes" VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[],
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "firstConflictAt" TIMESTAMP(3),
  "conflictingPayloadFingerprint" VARCHAR(64),
  "lastConflictAt" TIMESTAMP(3),
  "lastConflictingPayloadFingerprint" VARCHAR(64),
  CONSTRAINT "provider_event_inbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_event_inbox_provider_check" CHECK ("provider" = 'acs'),
  CONSTRAINT "provider_event_inbox_provider_status_check" CHECK (
    "providerStatus" IS NULL OR "providerStatus" IN (
      'Delivered', 'Suppressed', 'Bounced', 'Quarantined',
      'FilteredSpam', 'Expanded', 'Failed'
    )
  ),
  CONSTRAINT "provider_event_inbox_fingerprints_check" CHECK (
    "eventIdFingerprint" ~ '^[0-9a-f]{64}$'
    AND "payloadFingerprint" ~ '^[0-9a-f]{64}$'
    AND "topicFingerprint" ~ '^[0-9a-f]{64}$'
    AND ("conflictingPayloadFingerprint" IS NULL OR "conflictingPayloadFingerprint" ~ '^[0-9a-f]{64}$')
    AND ("lastConflictingPayloadFingerprint" IS NULL OR "lastConflictingPayloadFingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "provider_event_inbox_processing_status_check" CHECK ("processingStatus" IN ('PENDING', 'QUARANTINED', 'PROCESSING', 'PROCESSED', 'CONFLICT')),
  CONSTRAINT "provider_event_inbox_attempts_check" CHECK ("processingAttempts" >= 0),
  CONSTRAINT "provider_event_inbox_quarantine_reasons_check" CHECK (
    cardinality("quarantineReasonCodes") <= 4
    AND "quarantineReasonCodes" <@ ARRAY[
      'PROVIDER_MESSAGE_ID_MISSING',
      'PROVIDER_STATUS_MISSING',
      'PROVIDER_STATUS_UNSUPPORTED',
      'EVENT_GRID_VERSION_UNSUPPORTED'
    ]::VARCHAR(100)[]
    AND (("processingStatus" = 'QUARANTINED') = (cardinality("quarantineReasonCodes") > 0)
      OR "processingStatus" = 'CONFLICT')
  ),
  CONSTRAINT "provider_event_inbox_conflict_state_check" CHECK (
    (
      "processingStatus" <> 'CONFLICT'
      AND "conflictCount" = 0
      AND "firstConflictAt" IS NULL
      AND "conflictingPayloadFingerprint" IS NULL
      AND "lastConflictAt" IS NULL
      AND "lastConflictingPayloadFingerprint" IS NULL
    ) OR (
      "processingStatus" = 'CONFLICT'
      AND "conflictCount" > 0
      AND "firstConflictAt" IS NOT NULL
      AND "conflictingPayloadFingerprint" IS NOT NULL
      AND "lastConflictAt" IS NOT NULL
      AND "lastConflictingPayloadFingerprint" IS NOT NULL
      AND "lastConflictAt" >= "firstConflictAt"
    )
  ),
  CONSTRAINT "provider_event_inbox_lease_check" CHECK (("processingLeaseId" IS NULL) = ("processingLeaseExpiresAt" IS NULL)),
  CONSTRAINT "provider_event_inbox_processing_lease_state_check" CHECK (("processingStatus" = 'PROCESSING') = ("processingLeaseId" IS NOT NULL)),
  CONSTRAINT "provider_event_inbox_processed_state_check" CHECK (
    ("processingStatus" <> 'PROCESSED' OR "processedAt" IS NOT NULL)
    AND ("processedAt" IS NULL OR "processingStatus" IN ('PROCESSED', 'CONFLICT'))
  )
);

CREATE UNIQUE INDEX "provider_event_inbox_provider_eventIdFingerprint_key"
  ON "provider_event_inbox"("provider", "eventIdFingerprint");
CREATE INDEX "provider_event_inbox_processing_due_idx"
  ON "provider_event_inbox"("processingStatus", "nextProcessingAt", "processingLeaseExpiresAt");
CREATE INDEX "provider_event_inbox_provider_message_idx"
  ON "provider_event_inbox"("provider", "providerMessageId");
CREATE INDEX "provider_event_inbox_received_idx" ON "provider_event_inbox"("receivedAt");

REVOKE ALL ON TABLE "provider_event_inbox" FROM PUBLIC;
-- Remove any broad ALTER DEFAULT PRIVILEGES grants inherited at table creation.
-- The operator grants SELECT/INSERT/UPDATE only to the dedicated ingress role
-- after migration deployment and before running the ingress preflight.
DO $$
DECLARE
  granted_role record;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT grantee
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = 'provider_event_inbox'
      AND grantee <> current_user
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE "provider_event_inbox" FROM %I', granted_role.grantee);
  END LOOP;
END;
$$;

CREATE FUNCTION prevent_provider_event_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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
    RAISE EXCEPTION 'provider event first-seen evidence is immutable';
  END IF;

  IF OLD."processingStatus" = 'CONFLICT' AND NEW."processingStatus" <> 'CONFLICT' THEN
    RAISE EXCEPTION 'provider event conflict state is terminal';
  END IF;

  IF OLD."firstConflictAt" IS NOT NULL AND ROW(
    NEW."firstConflictAt", NEW."conflictingPayloadFingerprint"
  ) IS DISTINCT FROM ROW(
    OLD."firstConflictAt", OLD."conflictingPayloadFingerprint"
  ) THEN
    RAISE EXCEPTION 'provider event first conflict evidence is immutable';
  END IF;

  IF NEW."conflictCount" <> OLD."conflictCount" THEN
    IF NEW."conflictCount" <> OLD."conflictCount" + 1
      OR NEW."processingStatus" <> 'CONFLICT'
      OR NEW."lastConflictAt" IS NULL
      OR NEW."lastConflictingPayloadFingerprint" IS NULL
      OR (OLD."lastConflictAt" IS NOT NULL AND NEW."lastConflictAt" < OLD."lastConflictAt")
    THEN
      RAISE EXCEPTION 'provider event conflict evidence must advance monotonically';
    END IF;
  ELSIF ROW(
    NEW."firstConflictAt", NEW."conflictingPayloadFingerprint",
    NEW."lastConflictAt", NEW."lastConflictingPayloadFingerprint"
  ) IS DISTINCT FROM ROW(
    OLD."firstConflictAt", OLD."conflictingPayloadFingerprint",
    OLD."lastConflictAt", OLD."lastConflictingPayloadFingerprint"
  ) THEN
    RAISE EXCEPTION 'provider event conflict evidence requires a count increment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_event_evidence_immutable
BEFORE UPDATE ON "provider_event_inbox"
FOR EACH ROW EXECUTE FUNCTION prevent_provider_event_evidence_change();

COMMIT;
