-- A self-service organization first receives an internal provisional slug at
-- email verification, then claims its public workspace subdomain exactly once
-- while onboarding its untouched starter draft room.
-- Existing organizations are deliberately ineligible. Only organizations
-- created by the current self-service verification flow set this marker.
ALTER TABLE "organizations"
  ADD COLUMN "workspaceUrlClaimEligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "workspaceUrlClaimedAt" TIMESTAMP(3);
