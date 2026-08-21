-- Persist explicit room assignments for team viewer invitations. An
-- organization VIEWER has no implicit room access, so acceptance uses these
-- rows to create direct ROOM/USER/VIEW permissions atomically.
CREATE TABLE "invitation_room_assignments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "invitation_room_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitation_room_assignments_invitationId_roomId_key"
  ON "invitation_room_assignments"("invitationId", "roomId");
CREATE INDEX "invitation_room_assignments_roomId_idx"
  ON "invitation_room_assignments"("roomId");

ALTER TABLE "invitation_room_assignments"
  ADD CONSTRAINT "invitation_room_assignments_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitation_room_assignments"
  ADD CONSTRAINT "invitation_room_assignments_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitation_room_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation_room_assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY invitation_room_assignment_bootstrap_lookup ON "invitation_room_assignments"
  FOR SELECT
  USING (NULLIF(current_setting('app.current_org_id', true), '') IS NULL);

CREATE POLICY invitation_room_assignment_org_isolation ON "invitation_room_assignments"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM "invitations" invitation
      WHERE invitation."id" = "invitation_room_assignments"."invitationId"
        AND invitation."organizationId" = current_setting('app.current_org_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "invitations" invitation
      WHERE invitation."id" = "invitation_room_assignments"."invitationId"
        AND invitation."organizationId" = current_setting('app.current_org_id', true)
    )
    AND EXISTS (
      SELECT 1
      FROM "rooms" room
      WHERE room."id" = "invitation_room_assignments"."roomId"
        AND room."organizationId" = current_setting('app.current_org_id', true)
    )
  );

-- The runtime application role creates and reads assignments through RLS. Do
-- not rely on the migration owner's default privileges, which can differ from
-- the role that provisioned the deployment. UPDATE and DELETE remain withheld:
-- assignments are immutable after invite creation and expire with their parent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    GRANT SELECT, INSERT ON TABLE public.invitation_room_assignments TO vaultspace_app;
    REVOKE UPDATE, DELETE ON TABLE public.invitation_room_assignments FROM vaultspace_app;
    IF NOT has_table_privilege('vaultspace_app', 'public.invitation_room_assignments', 'SELECT, INSERT') THEN
      RAISE EXCEPTION 'vaultspace_app is missing SELECT or INSERT on invitation_room_assignments';
    END IF;
    IF has_table_privilege('vaultspace_app', 'public.invitation_room_assignments', 'UPDATE')
       OR has_table_privilege('vaultspace_app', 'public.invitation_room_assignments', 'DELETE') THEN
      RAISE EXCEPTION 'vaultspace_app must not have UPDATE or DELETE on invitation_room_assignments';
    END IF;
  END IF;
END $$;
