-- Document withdrawal (tombstone). A withdrawn document stays in the room but is
-- not viewable; its retired accession number resolves to "withdrawn" rather than
-- vanishing. Distinct from soft-delete (trash).
ALTER TABLE "documents" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "withdrawnReason" TEXT;
