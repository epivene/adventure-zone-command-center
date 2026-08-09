BEGIN;

ALTER TABLE act_replacement_review_decisions
  ADD COLUMN IF NOT EXISTS reviewed_source_value jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_source_value_fingerprint text,
  ADD COLUMN IF NOT EXISTS reviewed_local_value jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_local_value_fingerprint text;

COMMIT;
