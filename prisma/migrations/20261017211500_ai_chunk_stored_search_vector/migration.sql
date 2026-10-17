-- Build lexical rank from a stored search vector. The original expression
-- index avoided recomputing the match predicate for selective terms, but
-- ranking a common term still reconstructed every matching chunk's tsvector.
ALTER TABLE "ai_chunks"
  ADD COLUMN "contentSearch" tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, "content")) STORED;

CREATE INDEX "ai_chunks_contentSearch_idx"
  ON "ai_chunks" USING GIN ("contentSearch");

DROP INDEX "ai_chunks_fts_idx";
ANALYZE "ai_chunks";
