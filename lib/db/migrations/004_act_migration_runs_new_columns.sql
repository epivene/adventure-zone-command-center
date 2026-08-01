-- Migration 004: add columns to act_migration_runs that were introduced by
-- schema updates after the initial table creation. Idempotent via IF NOT EXISTS.

ALTER TABLE act_migration_runs
  ADD COLUMN IF NOT EXISTS source_database_key   text,
  ADD COLUMN IF NOT EXISTS source_digest         text,
  ADD COLUMN IF NOT EXISTS proposal_digest       text,
  ADD COLUMN IF NOT EXISTS summary               jsonb,
  ADD COLUMN IF NOT EXISTS last_error_code       text,
  ADD COLUMN IF NOT EXISTS snapshot_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS preview_completed_at  timestamptz;

-- source_database_key is NOT NULL in the schema; backfill existing rows with
-- a placeholder so we can add the constraint without blocking on empty DBs.
UPDATE act_migration_runs
  SET source_database_key = 'unknown'
  WHERE source_database_key IS NULL;

-- Add the NOT NULL constraint only if it isn't already there.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name  = 'act_migration_runs'
      AND column_name = 'source_database_key'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE act_migration_runs
      ALTER COLUMN source_database_key SET NOT NULL;
  END IF;
END $$;

-- Add the non-blank check constraint if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_migration_runs_source_database_key_nonblank'
  ) THEN
    ALTER TABLE act_migration_runs
      ADD CONSTRAINT act_migration_runs_source_database_key_nonblank
      CHECK (btrim(source_database_key) <> '');
  END IF;
END $$;
