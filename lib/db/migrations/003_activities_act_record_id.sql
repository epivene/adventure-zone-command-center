-- Migration: add act_record_id to activities for idempotent Act! history import.
-- The column is nullable; a partial unique index enforces uniqueness only for
-- non-null values so manually-created activities (which have no Act! ID) are unaffected.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS act_record_id text;

CREATE UNIQUE INDEX IF NOT EXISTS activities_act_record_id_unique
  ON activities (act_record_id)
  WHERE act_record_id IS NOT NULL;
