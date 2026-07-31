-- Expand-only recovery storage for HMAC password reset delivery. Older
-- application revisions ignore this table and continue writing legacy flows.
BEGIN;

ALTER TABLE "password_reset_tokens"
  ADD COLUMN "provider" VARCHAR(32),
  ADD COLUMN "providerOperationId" VARCHAR(255),
  ADD COLUMN "providerAcceptedAt" TIMESTAMP(3);

ALTER TABLE "events" ADD COLUMN "idempotencyKey" VARCHAR(255);
CREATE UNIQUE INDEX "events_idempotencyKey_key" ON "events"("idempotencyKey");

-- A transaction-local custom GUC reads back as an empty string after reset on
-- a reused PostgreSQL connection. Treat that state as no tenant context so
-- runtime-role bootstrap reads remain deterministic without BYPASSRLS.
DROP POLICY IF EXISTS org_bootstrap_lookup ON organizations;
CREATE POLICY org_bootstrap_lookup ON organizations
  FOR SELECT
  USING (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    AND "isActive" = true
  );

DROP POLICY IF EXISTS org_bootstrap_insert ON organizations;
CREATE POLICY org_bootstrap_insert ON organizations
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.current_org_id', true), '') IS NULL);

DROP POLICY IF EXISTS user_bootstrap_lookup ON users;
CREATE POLICY user_bootstrap_lookup ON users
  FOR SELECT
  USING (NULLIF(current_setting('app.current_org_id', true), '') IS NULL);

DROP POLICY IF EXISTS user_bootstrap_insert ON users;
CREATE POLICY user_bootstrap_insert ON users
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.current_org_id', true), '') IS NULL);

DROP POLICY IF EXISTS user_org_bootstrap_lookup ON user_organizations;
CREATE POLICY user_org_bootstrap_lookup ON user_organizations
  FOR SELECT
  USING (NULLIF(current_setting('app.current_org_id', true), '') IS NULL);

DROP POLICY IF EXISTS user_org_bootstrap_insert ON user_organizations;
CREATE POLICY user_org_bootstrap_insert ON user_organizations
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.current_org_id', true), '') IS NULL);

DROP POLICY IF EXISTS invitation_bootstrap_lookup ON invitations;
CREATE POLICY invitation_bootstrap_lookup ON invitations
  FOR SELECT
  USING (NULLIF(current_setting('app.current_org_id', true), '') IS NULL);

CREATE TABLE "password_reset_recoveries" (
    "flowId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientFingerprint" VARCHAR(64) NOT NULL,
    "cipherVersion" INTEGER,
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
    "acceptanceAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextAcceptanceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_recoveries_pkey" PRIMARY KEY ("flowId"),
    CONSTRAINT "password_reset_recoveries_envelope_complete" CHECK (
      ("cipherVersion" IS NULL AND "keyId" IS NULL AND "nonce" IS NULL AND "ciphertext" IS NULL AND "authTag" IS NULL) OR
      ("cipherVersion" = 1 AND "keyId" IS NOT NULL AND octet_length("nonce") = 12 AND
       octet_length("authTag") = 16 AND octet_length("ciphertext") BETWEEN 48 AND 128)
    ),
    CONSTRAINT "password_reset_recoveries_attempt_positive" CHECK ("deliveryAttempt" > 0),
    CONSTRAINT "password_reset_recoveries_fence_nonnegative" CHECK ("sendFence" >= 0)
);

CREATE INDEX "prr_enqueue_due_lease_idx"
  ON "password_reset_recoveries"("enqueueStatus", "nextEnqueueAt", "enqueueLeaseExpiresAt");
CREATE INDEX "prr_send_lease_idx"
  ON "password_reset_recoveries"("sendLeaseExpiresAt");
CREATE INDEX "prr_wipe_created_idx"
  ON "password_reset_recoveries"("wipedAt", "createdAt");

ALTER TABLE "password_reset_recoveries"
  ADD CONSTRAINT "password_reset_recoveries_flowId_fkey"
  FOREIGN KEY ("flowId") REFERENCES "password_reset_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
