ALTER TYPE "PlatformAuditAction" ADD VALUE 'ACCOUNT_LINKED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'ACCOUNT_UNLINKED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'ACCOUNT_SWITCH_SESSION_STARTED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'ACCOUNT_SWITCHED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'ACCOUNT_SWITCH_SESSION_ENDED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'ACCOUNT_SWITCH_SESSION_EXPIRED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'ACCOUNT_SWITCH_DENIED';

CREATE TABLE "account_links" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "primaryUserId" TEXT NOT NULL,
  "secondaryUserId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_links_distinct_users" CHECK ("primaryUserId" <> "secondaryUserId")
);

CREATE UNIQUE INDEX "account_links_secondaryUserId_key" ON "account_links"("secondaryUserId");
CREATE UNIQUE INDEX "account_links_primaryUserId_secondaryUserId_key"
  ON "account_links"("primaryUserId", "secondaryUserId");
CREATE INDEX "account_links_primaryUserId_idx" ON "account_links"("primaryUserId");
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_primaryUserId_fkey"
  FOREIGN KEY ("primaryUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_secondaryUserId_fkey"
  FOREIGN KEY ("secondaryUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "account_switch_sessions" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "primaryUserId" TEXT NOT NULL,
  "currentUserId" TEXT NOT NULL,
  "currentTenantSessionId" VARCHAR(255) NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mfaVerifiedAt" TIMESTAMP(3) NOT NULL,
  "primaryMfaKeyHash" CHAR(64) NOT NULL,
  "ipSubnet" VARCHAR(50),
  "userAgentHash" VARCHAR(64),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "account_switch_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_switch_sessions_expiry" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "account_switch_sessions_tokenHash_key"
  ON "account_switch_sessions"("tokenHash");
CREATE INDEX "account_switch_sessions_primaryUserId_isActive_idx"
  ON "account_switch_sessions"("primaryUserId", "isActive");
CREATE INDEX "account_switch_sessions_currentTenantSessionId_isActive_idx"
  ON "account_switch_sessions"("currentTenantSessionId", "isActive");
CREATE INDEX "account_switch_sessions_expiresAt_idx"
  ON "account_switch_sessions"("expiresAt");
ALTER TABLE "account_switch_sessions" ADD CONSTRAINT "account_switch_sessions_primaryUserId_fkey"
  FOREIGN KEY ("primaryUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_switch_sessions" ADD CONSTRAINT "account_switch_sessions_currentUserId_fkey"
  FOREIGN KEY ("currentUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Identity relationships and switch proofs are global security state. The
-- ordinary tenant runtime role cannot read or mutate either table directly.
ALTER TABLE "account_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_links" FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_switch_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_switch_sessions" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "account_links", "account_switch_sessions" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vaultspace_app') THEN
    REVOKE ALL ON TABLE public.account_links, public.account_switch_sessions FROM vaultspace_app;
  END IF;
END $$;
