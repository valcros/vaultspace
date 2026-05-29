-- Add roomId to search_indexes for direct room-scoped filtering
-- roomId is nullable for migration safety; backfilled from documents below.
ALTER TABLE "search_indexes" ADD COLUMN "roomId" TEXT;

-- Composite index for room-scoped search queries
CREATE INDEX IF NOT EXISTS "search_indexes_organizationId_roomId_idx"
ON "search_indexes" ("organizationId", "roomId");

-- Backfill existing rows from documents.roomId
UPDATE "search_indexes" si
SET "roomId" = d."roomId"
FROM "documents" d
WHERE d.id = si."documentId"
  AND si."roomId" IS NULL;

-- FTS index matching the expression used in /api/search for planner reuse.
-- Standard (non-CONCURRENT) CREATE INDEX runs inside a migration transaction.
CREATE INDEX IF NOT EXISTS "search_indexes_fts_idx"
ON "search_indexes"
USING gin(
  to_tsvector('english',
    coalesce("extractedText", '') || ' ' ||
    coalesce("documentTitle", '') || ' ' ||
    coalesce("fileName", '')
  )
);
