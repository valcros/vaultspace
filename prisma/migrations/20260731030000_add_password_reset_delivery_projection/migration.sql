-- Expand-only correlation and audit-integrity fields for provider final
-- delivery evidence. Older application revisions ignore these columns.
BEGIN;

ALTER TABLE "password_reset_tokens"
  ADD COLUMN "auditOrganizationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "providerFinalStatus" VARCHAR(32),
  ADD COLUMN "providerFinalOutcome" VARCHAR(16),
  ADD COLUMN "providerFinalEventAt" TIMESTAMP(3),
  ADD COLUMN "providerFinalRecordedAt" TIMESTAMP(3),
  ADD COLUMN "providerFinalEventIdFingerprint" VARCHAR(64);

-- Once populated, the audit scope is immutable. Empty legacy snapshots may be
-- repaired exactly once by an approved reconciliation process. The migration
-- deliberately does not copy organizationId into this array because that value
-- may represent only one member of a historical multi-organization audit set.
CREATE FUNCTION prevent_password_reset_audit_scope_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF cardinality(OLD."auditOrganizationIds") > 0
     AND NEW."auditOrganizationIds" IS DISTINCT FROM OLD."auditOrganizationIds" THEN
    RAISE EXCEPTION 'password reset audit organization snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER password_reset_audit_scope_immutable
BEFORE UPDATE OF "auditOrganizationIds" ON "password_reset_tokens"
FOR EACH ROW EXECUTE FUNCTION prevent_password_reset_audit_scope_change();

CREATE INDEX "password_reset_tokens_provider_providerMessageId_idx"
  ON "password_reset_tokens"("provider", "providerMessageId");

COMMIT;
