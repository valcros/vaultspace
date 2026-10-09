-- Add an organization-independent system folder catalog and its revision ledger.
-- Existing tenant room_templates and the sealed PlatformAuditEvent ledger are unchanged.
CREATE TABLE "system_room_templates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "folders" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "system_room_template_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "templateId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "snapshot" JSONB NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "system_room_template_revisions_templateId_revision_key"
  ON "system_room_template_revisions" ("templateId", "revision");
CREATE INDEX "system_room_template_revisions_actorUserId_createdAt_idx"
  ON "system_room_template_revisions" ("actorUserId", "createdAt");

CREATE FUNCTION public.prevent_system_room_template_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SYSTEM_ROOM_TEMPLATE_REVISION_IMMUTABLE';
END;
$$;
CREATE TRIGGER system_room_template_revisions_are_immutable
  BEFORE UPDATE OR DELETE ON "system_room_template_revisions"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_system_room_template_revision_mutation();
CREATE TRIGGER system_room_template_revisions_cannot_be_truncated
  BEFORE TRUNCATE ON "system_room_template_revisions"
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_system_room_template_revision_mutation();

REVOKE ALL ON TABLE public.system_room_templates, public.system_room_template_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_system_room_template_revision_mutation() FROM PUBLIC;
-- Global tables deliberately have no tenant RLS. Authenticated platform routes
-- enforce operator authority and recheck it inside the service transaction.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaultspace_app') THEN
    REVOKE ALL ON TABLE public.system_room_templates, public.system_room_template_revisions FROM vaultspace_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.system_room_templates TO vaultspace_app;
    GRANT SELECT, INSERT ON TABLE public.system_room_template_revisions TO vaultspace_app;
    IF NOT has_table_privilege('vaultspace_app', 'public.system_room_templates', 'SELECT')
      OR NOT has_table_privilege('vaultspace_app', 'public.system_room_templates', 'INSERT')
      OR NOT has_table_privilege('vaultspace_app', 'public.system_room_templates', 'UPDATE')
      OR NOT has_table_privilege('vaultspace_app', 'public.system_room_template_revisions', 'SELECT')
      OR NOT has_table_privilege('vaultspace_app', 'public.system_room_template_revisions', 'INSERT') THEN
      RAISE EXCEPTION 'SYSTEM_ROOM_TEMPLATE_RUNTIME_GRANTS_MISSING';
    END IF;
    IF has_table_privilege('vaultspace_app', 'public.system_room_templates', 'DELETE')
      OR has_table_privilege('vaultspace_app', 'public.system_room_templates', 'TRUNCATE')
      OR has_table_privilege('vaultspace_app', 'public.system_room_template_revisions', 'UPDATE')
      OR has_table_privilege('vaultspace_app', 'public.system_room_template_revisions', 'DELETE')
      OR has_table_privilege('vaultspace_app', 'public.system_room_template_revisions', 'TRUNCATE') THEN
      RAISE EXCEPTION 'SYSTEM_ROOM_TEMPLATE_RUNTIME_DESTRUCTIVE_GRANTS_NOT_DENIED';
    END IF;
  END IF;
END;
$$;
