ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'QUESTION_ACTIVITY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCESS_REQUEST';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ACCESS_REQUEST_SUBMITTED';

ALTER TABLE "notifications"
  ADD COLUMN "actionPath" VARCHAR(500),
  ADD COLUMN "sourceEventId" VARCHAR(100);

CREATE UNIQUE INDEX "notifications_userOrganizationId_sourceEventId_key"
  ON "notifications"("userOrganizationId", "sourceEventId");
CREATE INDEX "notifications_userOrganizationId_isRead_createdAt_id_idx"
  ON "notifications"("userOrganizationId", "isRead", "createdAt", "id");

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_org_isolation ON "notifications";
CREATE POLICY notification_org_isolation ON "notifications"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
    AND EXISTS (
      SELECT 1 FROM "user_organizations" recipient
      WHERE recipient.id = "userOrganizationId"
        AND recipient."organizationId" = notifications."organizationId"
    )
  );

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_preference_org_isolation ON "notification_preferences";
CREATE POLICY notification_preference_org_isolation ON "notification_preferences"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
    AND EXISTS (
      SELECT 1 FROM "user_organizations" recipient
      WHERE recipient.id = "userOrganizationId"
        AND recipient."organizationId" = notification_preferences."organizationId"
    )
  );
