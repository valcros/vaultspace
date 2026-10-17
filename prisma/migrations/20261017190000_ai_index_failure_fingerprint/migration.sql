-- A permanent failure applies only to the source/model/pipeline inputs that failed.
-- Existing failures have no fingerprint and are retried once by reconciliation.
ALTER TABLE "ai_index_jobs" ADD COLUMN "failureFingerprint" VARCHAR(64);
