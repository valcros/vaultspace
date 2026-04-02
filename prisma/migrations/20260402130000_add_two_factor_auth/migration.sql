-- AlterTable: Add two-factor authentication fields to users
ALTER TABLE "users" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "twoFactorSecret" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN "twoFactorBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
