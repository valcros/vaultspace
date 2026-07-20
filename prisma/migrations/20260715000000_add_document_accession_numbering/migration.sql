-- Document accession numbering (opt-in per room).
-- Immutable citation IDs assigned once at upload from a monotonic per-room
-- counter. A number is never reused once assigned, even after the document is
-- deleted. Rooms that do not enable numbering are unaffected (columns stay null).

ALTER TABLE "rooms" ADD COLUMN "accessionNumberingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rooms" ADD COLUMN "accessionPrefix" VARCHAR(16);
ALTER TABLE "rooms" ADD COLUMN "lastAccessionSeq" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "documents" ADD COLUMN "accessionNumber" VARCHAR(32);
ALTER TABLE "documents" ADD COLUMN "accessionSeq" INTEGER;

-- No accession number is ever reused within a room. Postgres allows multiple
-- NULLs in a unique index, so unnumbered documents/rooms do not collide.
CREATE UNIQUE INDEX "documents_roomId_accessionSeq_key" ON "documents"("roomId", "accessionSeq");
CREATE INDEX "documents_roomId_accessionNumber_idx" ON "documents"("roomId", "accessionNumber");
