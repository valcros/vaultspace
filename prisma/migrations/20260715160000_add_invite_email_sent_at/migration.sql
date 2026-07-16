-- Track when an invitation email was actually sent (initial invite or resend).
-- The scheduled invitation lifecycle job only sends reminders for links where
-- this is non-null, so links that were never emailed are never auto-reminded.
--
-- Intentionally NOT backfilled: existing links keep inviteEmailSentAt = NULL.
-- This makes the reminder scan a no-op for pre-existing invites (safe: no mass
-- re-send), and legacy pending invites are handled deliberately via the admin
-- "resend" action, which stamps this column and restarts the reminder cadence.
ALTER TABLE "links" ADD COLUMN "inviteEmailSentAt" TIMESTAMP(3);

CREATE INDEX "links_inviteEmailSentAt_idx" ON "links"("inviteEmailSentAt");
