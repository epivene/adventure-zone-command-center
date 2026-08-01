-- Migration 005: change act_migration_runs.request_key from uuid to text so
-- that keys with a "ui-" prefix (e.g. ui-1785604...-<uuid>) are accepted.
-- Idempotent: only runs the ALTER when the column is still typed as uuid.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name  = 'act_migration_runs'
      AND column_name = 'request_key'
      AND data_type   = 'uuid'
  ) THEN
    ALTER TABLE act_migration_runs
      ALTER COLUMN request_key TYPE text USING request_key::text;
  END IF;
END $$;
