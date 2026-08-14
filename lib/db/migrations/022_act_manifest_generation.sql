ALTER TABLE act_replacement_runs
  ADD COLUMN IF NOT EXISTS manifest_generation uuid;

ALTER TABLE act_replacement_apply_operations
  ADD COLUMN IF NOT EXISTS manifest_generation uuid;

CREATE INDEX IF NOT EXISTS act_replacement_apply_operations_current_manifest_idx
  ON act_replacement_apply_operations (run_id, manifest_generation);
