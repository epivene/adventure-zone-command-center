DO $$
BEGIN
  IF to_regtype('probability') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_DEFERRED: probability enum does not exist yet';
  END IF;

  IF to_regclass('bookings') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_DEFERRED: bookings table does not exist yet';
  END IF;
END $$;

-- Existing confirmed/imported bookings should reflect certainty immediately.
UPDATE bookings
SET probability = 'definite'::probability,
    updated_at = now()
WHERE status = 'confirmed'
  AND probability IS DISTINCT FROM 'definite'::probability;

-- Keep every workflow consistent: whenever a booking transitions into
-- confirmed (create, edit, call/follow-up completion, API, etc.), set its
-- probability to definite. A later Last Resort action can still lower the
-- probability because it updates probability without transitioning status.
CREATE OR REPLACE FUNCTION set_confirmed_booking_probability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'confirmed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
    NEW.probability := 'definite'::probability;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_confirmed_probability_trigger ON bookings;
CREATE TRIGGER bookings_confirmed_probability_trigger
BEFORE INSERT OR UPDATE OF status ON bookings
FOR EACH ROW
EXECUTE FUNCTION set_confirmed_booking_probability();
