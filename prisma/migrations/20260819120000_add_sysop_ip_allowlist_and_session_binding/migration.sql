-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'SYSOP_IP_ALLOWLIST_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'SYSOP_IP_BLOCKED';
ALTER TYPE "EventType" ADD VALUE 'SESSION_HIJACKING_SUSPECTED';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "ipSubnet" VARCHAR(50),
ADD COLUMN "userAgentHash" VARCHAR(64);

-- CreateTable
CREATE TABLE "sysop_ip_allowlists" (
    "id" TEXT NOT NULL,
    "cidr" VARCHAR(100) NOT NULL,
    "label" VARCHAR(255),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sysop_ip_allowlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sysop_security_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "ipAllowlistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sysop_security_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sysop_ip_allowlists_cidr_key" ON "sysop_ip_allowlists"("cidr");
