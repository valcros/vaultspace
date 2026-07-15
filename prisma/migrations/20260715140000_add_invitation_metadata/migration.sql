-- Viewer invitation metadata: invitee details, personal message, and reminder
-- tracking for the auto-reminder + expiry job. Inviter is the existing
-- createdByUserId. All additive/nullable.
ALTER TABLE "links" ADD COLUMN "inviteeName" VARCHAR(255);
ALTER TABLE "links" ADD COLUMN "inviteeCompany" VARCHAR(255);
ALTER TABLE "links" ADD COLUMN "inviteMessage" TEXT;
ALTER TABLE "links" ADD COLUMN "remindersSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "links" ADD COLUMN "lastReminderAt" TIMESTAMP(3);
