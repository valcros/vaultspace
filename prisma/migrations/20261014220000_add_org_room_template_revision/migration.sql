ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ROOM_TEMPLATE_CREATED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ROOM_TEMPLATE_UPDATED';

ALTER TABLE "room_templates"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "room_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS room_template_org_isolation ON "room_templates";
CREATE POLICY room_template_org_isolation ON "room_templates"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
