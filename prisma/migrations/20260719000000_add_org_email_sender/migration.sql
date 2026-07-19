-- Per-org email sender identity. Both nullable; when unset, email sends fall
-- back to the global ACS_SENDER_ADDRESS. emailSenderAddress must be provisioned
-- as a verified sender username (with its display name) on the ACS domain before
-- it will actually deliver.
ALTER TABLE "organizations" ADD COLUMN "emailSenderName" VARCHAR(255);
ALTER TABLE "organizations" ADD COLUMN "emailSenderAddress" VARCHAR(255);
