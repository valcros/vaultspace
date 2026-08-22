-- Organization-scoped profile and NDA-on-file metadata. This migration is
-- additive only: it does not classify, modify, or delete existing members.
CREATE TYPE "OrganizationUserType" AS ENUM (
  'FOUNDER',
  'INVESTOR',
  'PARTNER',
  'INVESTOR_REPRESENTATIVE',
  'EMPLOYEE',
  'CONSULTANT'
);

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'USER_NDA_ON_FILE_CHANGED';

ALTER TABLE "user_organizations"
  ADD COLUMN "company" VARCHAR(255),
  ADD COLUMN "phone" VARCHAR(32),
  ADD COLUMN "organizationUserType" "OrganizationUserType",
  ADD COLUMN "ndaOnFile" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ndaOnFileReference" VARCHAR(500),
  ADD COLUMN "ndaOnFileRecordedAt" TIMESTAMP(3),
  ADD COLUMN "ndaOnFileRecordedByUserId" TEXT;

ALTER TABLE "invitations"
  ADD COLUMN "inviteeFirstName" VARCHAR(100),
  ADD COLUMN "inviteeLastName" VARCHAR(100),
  ADD COLUMN "inviteeCompany" VARCHAR(255),
  ADD COLUMN "inviteePhone" VARCHAR(32),
  ADD COLUMN "inviteeUserType" "OrganizationUserType",
  ADD COLUMN "ndaOnFile" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ndaOnFileReference" VARCHAR(500);

-- Notification-center lookup is always constrained by the active
-- organization membership and newest-first ordering.
CREATE INDEX "notifications_org_membership_read_created_idx"
  ON "notifications"("organizationId", "userOrganizationId", "isRead", "createdAt" DESC);

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_org_isolation ON "notifications";
CREATE POLICY notification_org_isolation ON "notifications"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_preference_org_isolation ON "notification_preferences";
CREATE POLICY notification_preference_org_isolation ON "notification_preferences"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
