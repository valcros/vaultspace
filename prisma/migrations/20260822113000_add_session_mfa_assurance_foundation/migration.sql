-- Server-recorded MFA assurance is a prerequisite for issuing a separate
-- platform session. This migration is additive and does not change tenant
-- session resolution or authorize any SysOp route.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE TYPE "SessionAuthenticationAssurance" AS ENUM ('PASSWORD', 'MFA');

ALTER TABLE "sessions"
  ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "authenticationAssurance" "SessionAuthenticationAssurance" NOT NULL DEFAULT 'PASSWORD';

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_mfa_assurance_consistent"
  CHECK (
    ("mfaVerifiedAt" IS NULL AND "authenticationAssurance" = 'PASSWORD')
    OR ("mfaVerifiedAt" IS NOT NULL AND "authenticationAssurance" = 'MFA')
  );
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_mfa_before_expiry"
  CHECK ("mfaVerifiedAt" IS NULL OR "mfaVerifiedAt" <= "expiresAt");

COMMENT ON COLUMN "sessions"."mfaVerifiedAt" IS
  'Server-recorded completion time of the normal-session MFA path. MFA enrollment alone is not assurance.';
COMMENT ON COLUMN "sessions"."authenticationAssurance" IS
  'Authentication strength for this tenant session. Platform access must require a fresh MFA value.';

COMMIT;
