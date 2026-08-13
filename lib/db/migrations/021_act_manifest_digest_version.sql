BEGIN;

ALTER TABLE act_replacement_runs
  ADD COLUMN IF NOT EXISTS manifest_digest_version text;

ALTER TABLE act_replacement_runs
  DROP CONSTRAINT IF EXISTS act_replacement_runs_manifest_digest_version_valid,
  ADD CONSTRAINT act_replacement_runs_manifest_digest_version_valid
    CHECK (
      manifest_digest_version IS NULL
      OR manifest_digest_version = 'canonical-json-v1'
    );

COMMIT;
