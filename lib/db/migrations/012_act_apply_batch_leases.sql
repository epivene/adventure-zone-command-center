ALTER TABLE act_replacement_apply_batches
  ADD COLUMN IF NOT EXISTS replay_fingerprint text,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code text;

ALTER TABLE act_replacement_apply_batches
  DROP CONSTRAINT IF EXISTS act_replacement_apply_batches_lease_consistency;

ALTER TABLE act_replacement_apply_batches
  ADD CONSTRAINT act_replacement_apply_batches_lease_consistency
  CHECK ((state = 'applying' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR state <> 'applying');

CREATE INDEX IF NOT EXISTS act_replacement_apply_batches_expired_lease_idx
  ON act_replacement_apply_batches (run_id, lease_expires_at)
  WHERE state = 'applying';
