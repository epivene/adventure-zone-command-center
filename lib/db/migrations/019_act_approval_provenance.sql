BEGIN;

ALTER TABLE act_replacement_approval_requests
  ADD COLUMN IF NOT EXISTS approval_mode text,
  ADD COLUMN IF NOT EXISTS approval_mode_version integer;

ALTER TABLE act_replacement_approval_requests
  DROP CONSTRAINT IF EXISTS act_replacement_approval_requests_mode_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_approval_requests_mode_version_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_approval_requests_mode_pair_valid;

ALTER TABLE act_replacement_approval_requests
  ADD CONSTRAINT act_replacement_approval_requests_mode_valid
    CHECK (approval_mode IS NULL OR approval_mode IN ('automatic_safe','explicit_manual')) NOT VALID,
  ADD CONSTRAINT act_replacement_approval_requests_mode_version_valid
    CHECK (approval_mode_version IS NULL OR approval_mode_version = 1) NOT VALID,
  ADD CONSTRAINT act_replacement_approval_requests_mode_pair_valid
    CHECK (
      (approval_mode IS NULL AND approval_mode_version IS NULL)
      OR (approval_mode IS NOT NULL AND approval_mode_version IS NOT NULL)
    ) NOT VALID;

ALTER TABLE act_replacement_approval_requests
  VALIDATE CONSTRAINT act_replacement_approval_requests_mode_valid,
  VALIDATE CONSTRAINT act_replacement_approval_requests_mode_version_valid,
  VALIDATE CONSTRAINT act_replacement_approval_requests_mode_pair_valid;

COMMIT;
