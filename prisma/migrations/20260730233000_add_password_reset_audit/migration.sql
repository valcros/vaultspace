-- Add password-reset security correlation and delivery lifecycle fields. Reset
-- stages use the existing USER_PASSWORD_RESET event plus immutable metadata so
-- a prior application release remains enum-compatible during recovery.
BEGIN;

-- Cross-request authentication flow correlation. This stores only a non-secret
-- reset-record id, never the reset token itself.
ALTER TABLE "events" ADD COLUMN "correlationId" VARCHAR(100);
CREATE INDEX "events_correlationId_idx" ON "events"("correlationId");

-- Durable reset-email delivery lifecycle. Azure final-delivery status remains
-- in ACS diagnostics and is joined through providerMessageId.
ALTER TABLE "password_reset_tokens"
  ADD COLUMN "requestId" VARCHAR(100),
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "deliveryStatus" VARCHAR(32),
  ADD COLUMN "queueJobId" VARCHAR(255),
  ADD COLUMN "providerMessageId" VARCHAR(255),
  ADD COLUMN "deliveryErrorCode" VARCHAR(100),
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastDeliveryAttemptAt" TIMESTAMP(3);

-- Rows created before this lifecycle existed have no trustworthy delivery
-- state. They must never appear in the actionable PENDING reconciliation set.
UPDATE "password_reset_tokens"
SET "deliveryStatus" = 'LEGACY_UNKNOWN'
WHERE "deliveryStatus" IS NULL;

ALTER TABLE "password_reset_tokens"
  ALTER COLUMN "deliveryStatus" SET NOT NULL,
  ALTER COLUMN "deliveryStatus" SET DEFAULT 'PENDING';

CREATE INDEX "password_reset_tokens_organizationId_createdAt_idx"
  ON "password_reset_tokens"("organizationId", "createdAt");
CREATE INDEX "password_reset_tokens_deliveryStatus_createdAt_idx"
  ON "password_reset_tokens"("deliveryStatus", "createdAt");

COMMIT;
