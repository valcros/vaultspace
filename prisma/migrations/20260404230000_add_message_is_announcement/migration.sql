-- AlterTable
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "isAnnouncement" BOOLEAN NOT NULL DEFAULT false;
