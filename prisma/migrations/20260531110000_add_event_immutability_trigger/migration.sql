-- Enforce append-only audit events at the database layer.
-- SEC-013: audit events cannot be updated.
-- SEC-014: audit events cannot be deleted.

CREATE OR REPLACE FUNCTION prevent_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'events are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS events_are_immutable ON "events";

CREATE TRIGGER events_are_immutable
BEFORE UPDATE OR DELETE ON "events"
FOR EACH ROW
EXECUTE FUNCTION prevent_events_mutation();
