-- A self-service organization first receives an internal provisional slug at
-- email verification, then claims its public workspace subdomain exactly once
-- while onboarding its untouched starter draft room.
ALTER TABLE "organizations"
  ADD COLUMN "workspaceUrlClaimedAt" TIMESTAMP(3);
