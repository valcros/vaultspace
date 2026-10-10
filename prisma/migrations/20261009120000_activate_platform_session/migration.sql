ALTER TYPE "PlatformAuditAction" ADD VALUE 'SYSOP_SESSION_ENDED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'SYSOP_SESSION_EXPIRED';

ALTER TABLE "platform_sessions"
  ADD COLUMN "tenantSessionId" VARCHAR(255);

CREATE INDEX "platform_sessions_tenantSessionId_isActive_idx"
  ON "platform_sessions"("tenantSessionId", "isActive");
