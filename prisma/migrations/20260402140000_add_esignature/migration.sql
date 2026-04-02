-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('PENDING', 'SIGNED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "signature_requests" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "signerEmail" VARCHAR(255) NOT NULL,
    "signerName" VARCHAR(255),
    "status" "SignatureStatus" NOT NULL DEFAULT 'PENDING',
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "signatureData" TEXT,
    "signatureType" VARCHAR(20),
    "signatureIp" VARCHAR(50),
    "declineReason" TEXT,

    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signature_requests_organizationId_idx" ON "signature_requests"("organizationId");

-- CreateIndex
CREATE INDEX "signature_requests_roomId_idx" ON "signature_requests"("roomId");

-- CreateIndex
CREATE INDEX "signature_requests_documentId_idx" ON "signature_requests"("documentId");

-- CreateIndex
CREATE INDEX "signature_requests_signerEmail_idx" ON "signature_requests"("signerEmail");

-- CreateIndex
CREATE INDEX "signature_requests_status_idx" ON "signature_requests"("status");

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
