-- A fixed, bounded policy for acknowledged incidents. No role receives
-- EXECUTE here. A separate maintenance role is granted only after preflight.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_email_delivery_incident_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID))
      AND current_setting('vaultspace.email_incident_retention', true) = 'on'
      AND OLD."acknowledgedAt" IS NOT NULL
      AND OLD."eventAt" < (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '180 days'
      AND OLD."acknowledgedAt" < (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '30 days'
    THEN
      RETURN OLD;
    END IF;
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

CREATE FUNCTION public.purge_email_delivery_incidents_v1()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  deleted_count integer;
  cutoff_event timestamp := (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '180 days';
  cutoff_ack timestamp := (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '30 days';
BEGIN
  PERFORM set_config('vaultspace.email_incident_retention', 'on', true);
  WITH victims AS (
    SELECT "id"
    FROM public.email_delivery_incidents
    WHERE "eventAt" < cutoff_event
      AND "acknowledgedAt" IS NOT NULL
      AND "acknowledgedAt" < cutoff_ack
    ORDER BY "eventAt", "id"
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.email_delivery_incidents target
  USING victims
  WHERE target."id" = victims."id";
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  PERFORM set_config('vaultspace.email_incident_retention', 'off', true);

  INSERT INTO public.platform_audit_events
    ("id", "action", "outcome", "requestId", "reasonCode", "affectedItemCount")
  VALUES
    (gen_random_uuid()::text,
     'EMAIL_DELIVERY_INCIDENT_RETENTION_RUN'::public."PlatformAuditAction",
     'SUCCEEDED'::public."PlatformAuditOutcome",
     gen_random_uuid()::text,
     'RETENTION_180_DAY_EVENT_30_DAY_ACK',
     deleted_count);
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_email_delivery_incidents_v1() FROM PUBLIC;
DO $$
DECLARE granted_role record;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT pg_get_userbyid(acl.grantee) AS role_name
    FROM pg_proc fn,
         LATERAL aclexplode(COALESCE(fn.proacl, acldefault('f', fn.proowner))) acl
    WHERE fn.oid = 'public.purge_email_delivery_incidents_v1()'::regprocedure
      AND acl.grantee <> 0
      AND acl.grantee <> fn.proowner
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.purge_email_delivery_incidents_v1() FROM %I',
      granted_role.role_name
    );
  END LOOP;
END;
$$;

COMMIT;
