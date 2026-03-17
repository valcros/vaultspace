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
ALTER TABLE watermark_configs ENABLE ROW LEVEL SECURITY;
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

-- Watermark Configs policy
DROP POLICY IF EXISTS watermark_org_isolation ON watermark_configs;
CREATE POLICY watermark_org_isolation ON watermark_configs
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- Invitations policy
DROP POLICY IF EXISTS invitation_org_isolation ON invitations;
CREATE POLICY invitation_org_isolation ON invitations
  FOR ALL
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  );

-- ============================================================================
-- STEP 3: Grant necessary permissions to the application database user
-- ============================================================================

-- The app user should have SELECT, INSERT, UPDATE, DELETE on all tables
-- but RLS will restrict access to only their organization's data

-- Uncomment and modify with your actual app user name:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vaultspace_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vaultspace_app;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check which tables have RLS enabled:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Check policies:
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
