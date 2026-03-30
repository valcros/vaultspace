-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('FINANCIAL_STATEMENTS', 'TAX_RETURNS', 'CONTRACTS_AGREEMENTS', 'CORPORATE_DOCUMENTS', 'INTELLECTUAL_PROPERTY', 'PITCH_DECK', 'PROFORMA_PROJECTIONS', 'DUE_DILIGENCE', 'INSURANCE', 'COMPLIANCE', 'TECHNICAL_DOCS', 'HR_EMPLOYMENT', 'REAL_ESTATE_LEASE', 'OTHER');

-- AlterTable: Add category and confidential to documents
ALTER TABLE "documents" ADD COLUMN "category" "DocumentCategory";
ALTER TABLE "documents" ADD COLUMN "confidential" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add confidential to folders
ALTER TABLE "folders" ADD COLUMN "confidential" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add allDocumentsConfidential to rooms
ALTER TABLE "rooms" ADD COLUMN "allDocumentsConfidential" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "documents_category_idx" ON "documents"("category");
