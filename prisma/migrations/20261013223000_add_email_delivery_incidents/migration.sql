-- Redacted platform delivery incidents. Activation and collector grants are
-- separate operational steps. This migration grants no runtime access.
CREATE TABLE "email_delivery_incidents" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider" VARCHAR(32) NOT NULL,
  "providerMessageId" VARCHAR(255) NOT NULL,
  "recipientFingerprint" VARCHAR(64) NOT NULL,
  "recipientFingerprintKeyId" VARCHAR(64) NOT NULL,
  "recipientDomain" VARCHAR(253) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "failureReason" VARCHAR(100) NOT NULL DEFAULT '',
  "smtpStatusCode" VARCHAR(8) NOT NULL DEFAULT '',
  "enhancedSmtpStatusCode" VARCHAR(16) NOT NULL DEFAULT '',
  "recipientMailServer" VARCHAR(253) NOT NULL DEFAULT '',
  "eventAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedByUserId" VARCHAR(100),
  CONSTRAINT "email_delivery_incidents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_delivery_incidents_provider_check" CHECK ("provider" IN ('acs', 'smtp', 'webhook')),
  CONSTRAINT "email_delivery_incidents_status_check" CHECK ("status" IN ('Failed', 'Bounced', 'Suppressed', 'Quarantined', 'FilteredSpam')),
  CONSTRAINT "email_delivery_incidents_fingerprint_check" CHECK ("recipientFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "email_delivery_incidents_key_id_check" CHECK ("recipientFingerprintKeyId" ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT "email_delivery_incidents_message_id_check" CHECK ("providerMessageId" ~ '^[A-Za-z0-9._:-]{1,255}$'),
  CONSTRAINT "email_delivery_incidents_domain_check" CHECK ("recipientDomain" ~ '^[a-z0-9][a-z0-9.-]{0,252}$'),
  CONSTRAINT "email_delivery_incidents_smtp_check" CHECK ("smtpStatusCode" = '' OR "smtpStatusCode" ~ '^[0-9]{3}$'),
  CONSTRAINT "email_delivery_incidents_enhanced_smtp_check" CHECK ("enhancedSmtpStatusCode" = '' OR "enhancedSmtpStatusCode" ~ '^[0-9][.][0-9]{1,3}[.][0-9]{1,3}$'),
  CONSTRAINT "email_delivery_incidents_ack_pair_check" CHECK (("acknowledgedAt" IS NULL) = ("acknowledgedByUserId" IS NULL))
);

CREATE UNIQUE INDEX "email_delivery_incidents_provider_message_recipient_key"
  ON "email_delivery_incidents"("provider", "providerMessageId", "recipientFingerprint");
CREATE INDEX "email_delivery_incidents_ack_event_idx"
  ON "email_delivery_incidents"("acknowledgedAt", "eventAt");
CREATE INDEX "email_delivery_incidents_event_idx"
  ON "email_delivery_incidents"("eventAt");

REVOKE ALL ON TABLE "email_delivery_incidents" FROM PUBLIC;
DO $$
DECLARE granted_role record;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT grantee FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = 'email_delivery_incidents'
      AND grantee <> current_user
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.email_delivery_incidents FROM %I', granted_role.grantee);
  END LOOP;
END;
$$;

CREATE FUNCTION public.prevent_email_delivery_incident_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'EMAIL_DELIVERY_INCIDENT_DELETE_FORBIDDEN';
  END IF;
  IF OLD."acknowledgedAt" IS NOT NULL
    OR NEW."acknowledgedAt" IS NULL
    OR NEW."acknowledgedByUserId" IS NULL
    OR ROW(
      NEW."id", NEW."createdAt", NEW."provider", NEW."providerMessageId",
      NEW."recipientFingerprint", NEW."recipientFingerprintKeyId", NEW."recipientDomain",
      NEW."status", NEW."failureReason", NEW."smtpStatusCode", NEW."enhancedSmtpStatusCode",
      NEW."recipientMailServer", NEW."eventAt"
    ) IS DISTINCT FROM ROW(
      OLD."id", OLD."createdAt", OLD."provider", OLD."providerMessageId",
      OLD."recipientFingerprint", OLD."recipientFingerprintKeyId", OLD."recipientDomain",
      OLD."status", OLD."failureReason", OLD."smtpStatusCode", OLD."enhancedSmtpStatusCode",
      OLD."recipientMailServer", OLD."eventAt"
    ) THEN
    RAISE EXCEPTION 'EMAIL_DELIVERY_INCIDENT_MUTATION_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER email_delivery_incident_ack_once
BEFORE UPDATE OR DELETE ON "email_delivery_incidents"
FOR EACH ROW EXECUTE FUNCTION public.prevent_email_delivery_incident_mutation();

CREATE FUNCTION public.prevent_email_delivery_incident_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'EMAIL_DELIVERY_INCIDENT_TRUNCATE_FORBIDDEN';
END;
$$;

CREATE TRIGGER email_delivery_incident_no_truncate
BEFORE TRUNCATE ON "email_delivery_incidents"
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_email_delivery_incident_truncate();

REVOKE ALL ON FUNCTION public.prevent_email_delivery_incident_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_email_delivery_incident_truncate() FROM PUBLIC;
