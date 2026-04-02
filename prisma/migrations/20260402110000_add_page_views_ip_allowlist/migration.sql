-- Feature F026: Per-page View Analytics
-- Feature F018: IP Address Allowlist

-- Add ipAllowlist to rooms
ALTER TABLE "rooms" ADD COLUMN "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Create page_views table
CREATE TABLE "page_views" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT,
    "roomId" TEXT NOT NULL,
    "viewerEmail" VARCHAR(255),
    "viewSessionId" TEXT,
    "userId" TEXT,
    "pageNumber" INTEGER NOT NULL,
    "timeSpentMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- Indexes for page_views
CREATE INDEX "page_views_organizationId_idx" ON "page_views"("organizationId");
CREATE INDEX "page_views_documentId_idx" ON "page_views"("documentId");
CREATE INDEX "page_views_roomId_idx" ON "page_views"("roomId");
CREATE INDEX "page_views_viewerEmail_idx" ON "page_views"("viewerEmail");
CREATE INDEX "page_views_createdAt_idx" ON "page_views"("createdAt");

-- Foreign keys for page_views
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS policy for page_views (tenant isolation)
ALTER TABLE "page_views" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "page_views_tenant_isolation" ON "page_views"
    USING ("organizationId" = current_setting('app.organization_id', true));
