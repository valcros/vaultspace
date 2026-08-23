-- Supports the SysOp tenant directory's latest authenticated organization activity aggregation.
CREATE INDEX "sessions_organizationId_lastActiveAt_idx"
ON "sessions"("organizationId", "lastActiveAt");
