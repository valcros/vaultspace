ALTER TABLE "documents" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "expiryAction" VARCHAR(20);
CREATE INDEX "documents_expiresAt_idx" ON "documents"("expiresAt");
