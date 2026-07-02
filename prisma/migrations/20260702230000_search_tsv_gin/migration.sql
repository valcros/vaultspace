-- Full-text search support column (optimization audit finding 6).
-- STORED generated column keeps itself in sync on insert/update (backfill is
-- automatic during this migration), and the GIN index replaces per-row
-- to_tsvector sequential scans in /api/search.

-- AlterTable
ALTER TABLE "search_indexes"
  ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce("extractedText", '') || ' ' ||
      coalesce("documentTitle", '') || ' ' ||
      coalesce("fileName", '')
    )
  ) STORED;

-- CreateIndex
CREATE INDEX "search_indexes_tsv_idx" ON "search_indexes" USING GIN ("tsv");
