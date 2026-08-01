-- Travel leg foundation for trips: archived state, base address, default
-- vehicle, and default MPG. Idempotent so it is safe on databases where the
-- columns were already applied manually.
ALTER TABLE travel_legs
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS base_address text,
  ADD COLUMN IF NOT EXISTS default_vehicle_name text,
  ADD COLUMN IF NOT EXISTS default_mpg double precision;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'travel_legs_default_mpg_positive'
  ) THEN
    ALTER TABLE travel_legs
      ADD CONSTRAINT travel_legs_default_mpg_positive
      CHECK (default_mpg IS NULL OR default_mpg > 0);
  END IF;
END $$;
