BEGIN;

INSERT INTO public.email_delivery_incidents
  ("id", "provider", "providerMessageId", "recipientFingerprint",
   "recipientFingerprintKeyId", "recipientDomain", "status", "eventAt",
   "acknowledgedAt", "acknowledgedByUserId")
VALUES
  ('retention-old-closed', 'acs', 'retention-old-closed', repeat('a', 64),
   'localtest', 'example.test', 'Bounced',
   (statement_timestamp() AT TIME ZONE 'UTC') - interval '200 days',
   (statement_timestamp() AT TIME ZONE 'UTC') - interval '40 days', 'operator'),
  ('retention-old-open', 'acs', 'retention-old-open', repeat('b', 64),
   'localtest', 'example.test', 'Bounced',
   (statement_timestamp() AT TIME ZONE 'UTC') - interval '200 days', NULL, NULL),
  ('retention-recent-ack', 'acs', 'retention-recent-ack', repeat('c', 64),
   'localtest', 'example.test', 'Bounced',
   (statement_timestamp() AT TIME ZONE 'UTC') - interval '200 days',
   (statement_timestamp() AT TIME ZONE 'UTC') - interval '5 days', 'operator'),
  ('retention-recent-event', 'acs', 'retention-recent-event', repeat('d', 64),
   'localtest', 'example.test', 'Bounced',
   (statement_timestamp() AT TIME ZONE 'UTC') - interval '10 days',
   (statement_timestamp() AT TIME ZONE 'UTC') - interval '5 days', 'operator');

DO $$
BEGIN
  BEGIN
    DELETE FROM public.email_delivery_incidents WHERE "id" = 'retention-old-closed';
    RAISE EXCEPTION 'DIRECT_DELETE_UNEXPECTEDLY_SUCCEEDED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'EMAIL_DELIVERY_INCIDENT_DELETE_FORBIDDEN' THEN
      RAISE;
    END IF;
  END;
END;
$$;

CREATE ROLE vaultspace_email_incident_retention_test LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO vaultspace_email_incident_retention_test;
GRANT EXECUTE ON FUNCTION public.purge_email_delivery_incidents_v1()
  TO vaultspace_email_incident_retention_test;

SET ROLE vaultspace_email_incident_retention_test;
DO $$
BEGIN
  IF has_table_privilege(current_user, 'public.email_delivery_incidents', 'SELECT')
    OR has_table_privilege(current_user, 'public.email_delivery_incidents', 'DELETE')
    OR has_table_privilege(current_user, 'public.platform_audit_events', 'INSERT')
  THEN
    RAISE EXCEPTION 'RETENTION_ROLE_TOO_BROAD';
  END IF;
END;
$$;

DO $$
DECLARE purged integer;
BEGIN
  SELECT public.purge_email_delivery_incidents_v1() INTO purged;
  IF purged <> 1 THEN
    RAISE EXCEPTION 'EXPECTED_ONE_PURGED_GOT_%', purged;
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.email_delivery_incidents WHERE "id" = 'retention-old-closed')
    OR (SELECT count(*) FROM public.email_delivery_incidents
        WHERE "id" LIKE 'retention-%') <> 3
    OR (SELECT count(*) FROM public.platform_audit_events
        WHERE "action" = 'EMAIL_DELIVERY_INCIDENT_RETENTION_RUN') <> 1
    OR (SELECT "affectedItemCount" FROM public.platform_audit_events
        WHERE "action" = 'EMAIL_DELIVERY_INCIDENT_RETENTION_RUN') <> 1
  THEN
    RAISE EXCEPTION 'RETENTION_RESULT_INVALID';
  END IF;
END;
$$;

ROLLBACK;
