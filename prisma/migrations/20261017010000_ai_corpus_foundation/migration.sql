-- AI corpus is private to an organization and remains off until a room policy
-- is enabled. Embeddings use a PostgreSQL array so baseline migrations work on
-- installations without pgvector. An optional staged HNSW index is separate.
CREATE TABLE "ai_policies" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL UNIQUE,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ai_sources" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL UNIQUE,
  "fileSha256" VARCHAR(64) NOT NULL,
  "contentSha256" VARCHAR(64) NOT NULL,
  "embeddingModelId" VARCHAR(120) NOT NULL,
  "pipelineRevision" INTEGER NOT NULL DEFAULT 1,
  "state" VARCHAR(24) NOT NULL DEFAULT 'READY',
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_sources_state_check" CHECK ("state" IN ('READY', 'INVALID')),
  CONSTRAINT "ai_sources_chunk_count_check" CHECK ("chunkCount" >= 0),
  CONSTRAINT "ai_sources_organizationId_id_key" UNIQUE ("organizationId", "id")
);
CREATE TABLE "ai_chunks" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "pageNumber" INTEGER,
  "content" TEXT NOT NULL,
  "contentSha256" VARCHAR(64) NOT NULL,
  "embedding" DOUBLE PRECISION[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_chunks_sourceId_ordinal_key" UNIQUE ("sourceId", "ordinal"),
  CONSTRAINT "ai_chunks_embedding_dims" CHECK (cardinality("embedding") = 1536),
  CONSTRAINT "ai_chunks_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "ai_chunks_page_check" CHECK ("pageNumber" IS NULL OR "pageNumber" >= 1)
);
CREATE TABLE "ai_index_jobs" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "state" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ai_index_jobs_organizationId_versionId_key" UNIQUE ("organizationId", "versionId"),
  CONSTRAINT "ai_index_jobs_state_check" CHECK ("state" IN ('PENDING', 'RUNNING', 'READY', 'FAILED', 'SKIPPED'))
);
CREATE TABLE "ai_index_audits" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "documentId" TEXT,
  "versionId" TEXT,
  "action" VARCHAR(40) NOT NULL,
  "outcome" VARCHAR(24) NOT NULL,
  "detailCode" VARCHAR(80),
  "chunkCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ai_policies_organizationId_enabled_idx" ON "ai_policies"("organizationId", "enabled");
CREATE UNIQUE INDEX "ai_policies_organizationId_roomId_key" ON "ai_policies"("organizationId", "roomId");
CREATE UNIQUE INDEX "ai_sources_organizationId_versionId_key" ON "ai_sources"("organizationId", "versionId");
CREATE UNIQUE INDEX "document_versions_organizationId_id_key" ON "document_versions"("organizationId", "id");
CREATE INDEX "ai_sources_organizationId_roomId_state_idx" ON "ai_sources"("organizationId", "roomId", "state");
CREATE INDEX "ai_sources_organizationId_documentId_idx" ON "ai_sources"("organizationId", "documentId");
CREATE INDEX "ai_chunks_organizationId_roomId_documentId_idx" ON "ai_chunks"("organizationId", "roomId", "documentId");
CREATE INDEX "ai_chunks_organizationId_versionId_idx" ON "ai_chunks"("organizationId", "versionId");
CREATE INDEX "ai_chunks_fts_idx" ON "ai_chunks" USING GIN (to_tsvector('english', "content"));
CREATE INDEX "ai_index_jobs_organizationId_state_updatedAt_idx" ON "ai_index_jobs"("organizationId", "state", "updatedAt");
CREATE INDEX "ai_index_audits_organizationId_createdAt_idx" ON "ai_index_audits"("organizationId", "createdAt");

ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "rooms"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "rooms"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "documents"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_organizationId_versionId_fkey" FOREIGN KEY ("organizationId", "versionId") REFERENCES "document_versions"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "ai_chunks" ADD CONSTRAINT "ai_chunks_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "ai_sources"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "ai_chunks" ADD CONSTRAINT "ai_chunks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "ai_index_jobs" ADD CONSTRAINT "ai_index_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "ai_index_jobs" ADD CONSTRAINT "ai_index_jobs_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "documents"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "ai_index_audits" ADD CONSTRAINT "ai_index_audits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "ai_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_policies_org_isolation" ON "ai_policies" FOR ALL USING ("organizationId" = current_setting('app.current_org_id', true)) WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
ALTER TABLE "ai_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_sources_org_isolation" ON "ai_sources" FOR ALL USING ("organizationId" = current_setting('app.current_org_id', true)) WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
ALTER TABLE "ai_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_chunks_org_isolation" ON "ai_chunks" FOR ALL USING ("organizationId" = current_setting('app.current_org_id', true)) WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
ALTER TABLE "ai_index_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_index_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_index_jobs_org_isolation" ON "ai_index_jobs" FOR ALL USING ("organizationId" = current_setting('app.current_org_id', true)) WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
ALTER TABLE "ai_index_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_index_audits" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_index_audits_org_isolation" ON "ai_index_audits" FOR ALL USING ("organizationId" = current_setting('app.current_org_id', true)) WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- Synchronous invalidation closes the gap before the periodic reconciler runs.
-- Expiry by passage of time is checked on every retrieval and reconciled later.
CREATE FUNCTION invalidate_ai_document_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."currentVersionId" IS DISTINCT FROM NEW."currentVersionId"
     OR NEW.status <> 'ACTIVE' OR NEW."deletedAt" IS NOT NULL
     OR NEW."withdrawnAt" IS NOT NULL
     OR (NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= now()) THEN
    DELETE FROM ai_sources WHERE "organizationId" = NEW."organizationId" AND "documentId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_document_invalidate AFTER UPDATE OF "currentVersionId", status, "deletedAt", "withdrawnAt", "expiresAt" ON documents
  FOR EACH ROW EXECUTE FUNCTION invalidate_ai_document_source();

CREATE FUNCTION invalidate_ai_version_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."scanStatus" <> 'CLEAN' THEN
    DELETE FROM ai_sources WHERE "organizationId" = NEW."organizationId" AND "versionId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_version_invalidate AFTER UPDATE OF "scanStatus" ON document_versions
  FOR EACH ROW EXECUTE FUNCTION invalidate_ai_version_source();

CREATE FUNCTION invalidate_ai_room_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'ACTIVE' OR NEW.mode <> 'INDEPENDENT' THEN
    DELETE FROM ai_sources WHERE "organizationId" = NEW."organizationId" AND "roomId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_room_invalidate AFTER UPDATE OF status, mode ON rooms
  FOR EACH ROW EXECUTE FUNCTION invalidate_ai_room_sources();

CREATE FUNCTION invalidate_ai_policy_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.enabled = false THEN
    DELETE FROM ai_sources WHERE "organizationId" = NEW."organizationId" AND "roomId" = NEW."roomId";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_policy_invalidate AFTER UPDATE OF enabled ON ai_policies
  FOR EACH ROW EXECUTE FUNCTION invalidate_ai_policy_sources();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vaultspace_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_policies, public.ai_sources, public.ai_chunks, public.ai_index_jobs, public.ai_index_audits TO vaultspace_app;
  END IF;
END;
$$;
