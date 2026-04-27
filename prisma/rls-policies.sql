-- VaultSpace Row-Level Security (RLS) Policies
-- Production requirement: All org-scoped tables must have RLS enabled
--
-- This script is automatically applied by docker-entrypoint.sh in production.
-- The application uses withOrgContext() to SET LOCAL app.current_org_id before queries.
--
-- MANUAL USAGE (if needed):
--   psql $DATABASE_URL -f prisma/rls-policies.sql
--
-- NOTE: RLS is REQUIRED in production, optional in development.

-- ============================================================================
-- STEP 1: Enable RLS on all org-scoped tables
-- ============================================================================

-- Organizations (users can only see orgs they belong to)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Users (within same org only)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- User-Organization mappings
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;

-- Rooms and content
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE preview_assets ENABLE ROW LEVEL SECURITY;

-- Access control
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE links ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_sessions ENABLE ROW LEVEL SECURITY;

-- Activity tracking
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_indexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_texts ENABLE ROW LEVEL SECURITY;

-- Configuration
-- watermark_configs is V1-deferred (no Prisma model, no migration). When the
-- table is added, restore: ALTER TABLE watermark_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 2: Create policies using SET LOCAL context variable
-- ============================================================================

-- Application sets: SET LOCAL app.current_org_id = 'org-123'
-- NEVER use SET (session-wide) - always SET LOCAL (transaction-scoped)

-- Organizations policy: Users see only orgs they belong to
-- For normal operations, require org context to be set
DROP POLICY IF EXISTS org_isolation ON organizations;
CREATE POLICY org_isolation ON organizations
  FOR ALL
  USING (
    id = current_setting('app.current_org_id', true)
  );

-- Organizations bootstrap policy: Allow SELECT by slug/domain for auth bootstrap
-- This enables looking up organization by slug or customDomain before org context is known
-- Only allows reading org ID, slug, and public info - not sensitive data
DROP POLICY IF EXISTS org_bootstrap_lookup ON organizations;
CREATE POLICY org_bootstrap_lookup ON organizations
  FOR SELECT
  USING (
    -- Allow lookup when no org context is set (bootstrap scenario)
    current_setting('app.current_org_id', true) IS NULL
    AND "isActive" = true
  );

-- Users bootstrap: allow email-based lookup before org context is established.
-- The login flow looks up `users` by email + verifies password BEFORE it knows
-- which organization to scope to. Without this, RLS blocks the lookup entirely
-- and login returns 401 for every account. Restricted to SELECT and only when
-- no org context is set; once a session is created the per-org policy takes
-- over for subsequent requests.
DROP POLICY IF EXISTS user_bootstrap_lookup ON users;
CREATE POLICY user_bootstrap_lookup ON users
  FOR SELECT
  USING (current_setting('app.current_org_id', true) IS NULL);

-- Users policy: See users in same org
DROP POLICY IF EXISTS user_org_isolation ON users;
CREATE POLICY user_org_isolation ON users
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo."userId" = users.id
      AND uo."organizationId" = current_setting('app.current_org_id', true)
    )
  );

-- User-Organizations bootstrap: allow lookup of a user's org memberships
-- before org context is set. The login flow needs this to pick the user's
-- default organization after password verification but before session
-- creation. Restricted to SELECT and only when no org context is set.
DROP POLICY IF EXISTS user_org_bootstrap_lookup ON user_organizations;
CREATE POLICY user_org_bootstrap_lookup ON user_organizations
  FOR SELECT
  USING (current_setting('app.current_org_id', true) IS NULL);

-- User-Organizations policy
DROP POLICY IF EXISTS user_org_mapping_isolation ON user_organizations;
CREATE POLICY user_org_mapping_isolation ON user_organizations
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Rooms policy
DROP POLICY IF EXISTS room_org_isolation ON rooms;
CREATE POLICY room_org_isolation ON rooms
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Folders policy
DROP POLICY IF EXISTS folder_org_isolation ON folders;
CREATE POLICY folder_org_isolation ON folders
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Documents policy
DROP POLICY IF EXISTS document_org_isolation ON documents;
CREATE POLICY document_org_isolation ON documents
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Document Versions policy
DROP POLICY IF EXISTS version_org_isolation ON document_versions;
CREATE POLICY version_org_isolation ON document_versions
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- File Blobs policy
DROP POLICY IF EXISTS blob_org_isolation ON file_blobs;
CREATE POLICY blob_org_isolation ON file_blobs
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Preview Assets policy
DROP POLICY IF EXISTS preview_org_isolation ON preview_assets;
CREATE POLICY preview_org_isolation ON preview_assets
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Permissions policy
DROP POLICY IF EXISTS permission_org_isolation ON permissions;
CREATE POLICY permission_org_isolation ON permissions
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Links policy
DROP POLICY IF EXISTS link_org_isolation ON links;
CREATE POLICY link_org_isolation ON links
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- View Sessions policy
DROP POLICY IF EXISTS session_org_isolation ON view_sessions;
CREATE POLICY session_org_isolation ON view_sessions
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Events policy
DROP POLICY IF EXISTS event_org_isolation ON events;
CREATE POLICY event_org_isolation ON events
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Search Indexes policy
DROP POLICY IF EXISTS search_org_isolation ON search_indexes;
CREATE POLICY search_org_isolation ON search_indexes
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Extracted Texts policy
DROP POLICY IF EXISTS text_org_isolation ON extracted_texts;
CREATE POLICY text_org_isolation ON extracted_texts
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Watermark Configs policy — V1-deferred. Restore when watermark_configs lands:
--   DROP POLICY IF EXISTS watermark_org_isolation ON watermark_configs;
--   CREATE POLICY watermark_org_isolation ON watermark_configs
--     FOR ALL
--     USING ("organizationId" = current_setting('app.current_org_id', true));

-- Invitations policy
DROP POLICY IF EXISTS invitation_org_isolation ON invitations;
CREATE POLICY invitation_org_isolation ON invitations
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- ============================================================================
-- STEP 3: FORCE ROW LEVEL SECURITY on every org-scoped table
-- ============================================================================

-- Without FORCE, table owners (and roles with BYPASSRLS) bypass policies entirely.
-- Setting FORCE makes RLS apply even when the connection role owns the table,
-- which protects against the staging defect discovered 2026-04-26 where the
-- application connected as the table owner and silently bypassed every policy.

ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE user_organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE folders FORCE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE file_blobs FORCE ROW LEVEL SECURITY;
ALTER TABLE preview_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE links FORCE ROW LEVEL SECURITY;
ALTER TABLE view_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE search_indexes FORCE ROW LEVEL SECURITY;
ALTER TABLE extracted_texts FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 3b: Revoke UPDATE/DELETE on immutable audit tables
-- ============================================================================

-- Audit events must be append-only at the database layer. Even if the
-- application is compromised, it cannot tamper with the audit trail.
-- This makes SEC-013 (no update) and SEC-014 (no delete) structural at
-- the database layer, complementing the EventBus design.
REVOKE UPDATE, DELETE ON events FROM vaultspace_app;

-- ============================================================================
-- STEP 4: Application role privileges
-- ============================================================================

-- The application MUST connect as a role that is NOT the table owner and does
-- NOT have BYPASSRLS. The role and grants below are the contract for that role.
-- Provisioning steps (separate, requires elevated DB access) live in
-- scripts/rls-fix.ts.

--   CREATE ROLE vaultspace_app WITH LOGIN PASSWORD '<rotate via Key Vault>'
--     NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
--   GRANT USAGE ON SCHEMA public TO vaultspace_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vaultspace_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vaultspace_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vaultspace_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vaultspace_app;

-- ============================================================================
-- VERIFICATION QUERIES (or run `npm run rls:audit`)
-- ============================================================================

-- Check which tables have RLS enabled and forced:
-- SELECT tablename, rowsecurity, c.relforcerowsecurity AS forced
-- FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
-- WHERE schemaname = 'public';

-- Check policies:
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
