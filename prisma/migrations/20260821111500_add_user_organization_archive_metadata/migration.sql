-- Organization membership archival is additive and intentionally contains no
-- data backfill. Existing inactive memberships remain legacy history until an
-- administrator performs a future explicit archive or restoration action.
ALTER TABLE "user_organizations"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByUserId" TEXT,
  ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "user_organizations_organizationId_isActive_archivedAt_idx"
  ON "user_organizations"("organizationId", "isActive", "archivedAt");

CREATE INDEX "user_organizations_organizationId_archivedAt_idx"
  ON "user_organizations"("organizationId", "archivedAt");
