-- Durable, verification-specific delivery state. No bearer tokens or recipient
-- addresses are stored in the queue-facing lifecycle fields.
ALTER TABLE "email_verification_tokens"
  ADD COLUMN "requestId" VARCHAR(100),
  ADD COLUMN "deliveryContractVersion" INTEGER,
  ADD COLUMN "deliveryStatus" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "queueJobId" VARCHAR(255),
  ADD COLUMN "provider" VARCHAR(32),
  ADD COLUMN "providerOperationId" VARCHAR(255),
  ADD COLUMN "providerMessageId" VARCHAR(255),
  ADD COLUMN "providerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryErrorCode" VARCHAR(100),
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastDeliveryAttemptAt" TIMESTAMP(3);

CREATE INDEX "email_verification_tokens_deliveryStatus_createdAt_idx"
  ON "email_verification_tokens"("deliveryStatus", "createdAt");
CREATE INDEX "email_verification_tokens_provider_providerMessageId_idx"
  ON "email_verification_tokens"("provider", "providerMessageId");

CREATE TABLE "email_verification_recoveries" (
  "flowId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipientFingerprint" VARCHAR(64) NOT NULL,
  "keyId" VARCHAR(64),
  "nonce" BYTEA,
  "ciphertext" BYTEA,
  "authTag" BYTEA,
  "encryptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "wipedAt" TIMESTAMP(3),
  "enqueueStatus" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "enqueueAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextEnqueueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enqueueLeaseId" VARCHAR(64),
  "enqueueLeaseExpiresAt" TIMESTAMP(3),
  "deliveryAttempt" INTEGER NOT NULL DEFAULT 1,
  "sendLeaseId" VARCHAR(64),
  "sendLeaseExpiresAt" TIMESTAMP(3),
  "sendFence" INTEGER NOT NULL DEFAULT 0,
  "providerOperationId" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_verification_recoveries_pkey" PRIMARY KEY ("flowId"),
  CONSTRAINT "email_verification_recoveries_operation_matches_flow_check"
    CHECK ("providerOperationId" = "flowId"),
  CONSTRAINT "email_verification_recoveries_flowId_fkey"
    FOREIGN KEY ("flowId") REFERENCES "email_verification_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "email_verification_recoveries_flow_operation_key"
  ON "email_verification_recoveries"("flowId", "providerOperationId");
CREATE INDEX "evr_enqueue_due_lease_idx"
  ON "email_verification_recoveries"("enqueueStatus", "nextEnqueueAt", "enqueueLeaseExpiresAt");
CREATE INDEX "evr_send_lease_idx" ON "email_verification_recoveries"("sendLeaseExpiresAt");
CREATE INDEX "evr_wipe_created_idx" ON "email_verification_recoveries"("wipedAt", "createdAt");
