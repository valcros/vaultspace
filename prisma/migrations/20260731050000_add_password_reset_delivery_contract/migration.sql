BEGIN;

ALTER TABLE public.password_reset_tokens
  ADD COLUMN "providerCorrelationSchemaVersion" INTEGER,
  ADD CONSTRAINT password_reset_delivery_contract_version_check
    CHECK (
      "providerCorrelationSchemaVersion" IS NULL
      OR "providerCorrelationSchemaVersion" = 1
    );

CREATE FUNCTION public.enforce_password_reset_delivery_contract_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  canonical_scope TEXT[];
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."providerCorrelationSchemaVersion"
       IS DISTINCT FROM OLD."providerCorrelationSchemaVersion" THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PASSWORD_RESET_DELIVERY_CONTRACT_MARKER_IMMUTABLE';
  END IF;

  IF NEW."providerCorrelationSchemaVersion" = 1 THEN
    SELECT array_agg(scope_id ORDER BY scope_id COLLATE "C")
      INTO canonical_scope
    FROM unnest(NEW."auditOrganizationIds") AS scope(scope_id);

    IF NEW.token !~ '^prh1:[0-9a-f]{64}$'
       OR cardinality(NEW."auditOrganizationIds") NOT BETWEEN 1 AND 64
       OR EXISTS (
         SELECT 1
         FROM unnest(NEW."auditOrganizationIds") AS scope(scope_id)
         WHERE scope_id IS NULL
            OR scope_id = ''
            OR scope_id <> btrim(scope_id)
            OR length(scope_id) > 100
            OR scope_id !~ '^[A-Za-z0-9_-]+$'
       )
       OR cardinality(NEW."auditOrganizationIds") <>
          (SELECT count(DISTINCT scope_id)
           FROM unnest(NEW."auditOrganizationIds") AS scope(scope_id))
       OR NEW."auditOrganizationIds" IS DISTINCT FROM canonical_scope THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PASSWORD_RESET_DELIVERY_CONTRACT_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_password_reset_delivery_contract_marker() FROM PUBLIC;

CREATE TRIGGER password_reset_delivery_contract_marker_guard
BEFORE INSERT OR UPDATE ON public.password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION public.enforce_password_reset_delivery_contract_marker();

COMMIT;
