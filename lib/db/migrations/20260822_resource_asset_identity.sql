ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS year_built integer,
  ADD COLUMN IF NOT EXISTS make text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS inspection_identity_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'resources_year_built_range'
  ) THEN
    ALTER TABLE resources
      ADD CONSTRAINT resources_year_built_range
      CHECK (year_built IS NULL OR (year_built >= 1900 AND year_built <= 2100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS resources_serial_number_lower_idx
  ON resources (lower(serial_number))
  WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '';
