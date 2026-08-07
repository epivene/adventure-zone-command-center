-- Separate durable approvals from bounded execution batches. An approval may
-- contain any dependency-closed safe set; each apply batch references a slice.

CREATE TABLE IF NOT EXISTS act_replacement_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL,
  run_id uuid NOT NULL REFERENCES act_replacement_runs(id) ON DELETE CASCADE,
  manifest_digest text NOT NULL,
  selected_operation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  dependency_closed_operation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_count integer NOT NULL DEFAULT 0,
  dependency_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_replacement_approval_requests_run_key_unique UNIQUE (run_id, request_key),
  CONSTRAINT act_replacement_approval_requests_digest_nonblank CHECK (btrim(manifest_digest) <> '')
);

ALTER TABLE act_replacement_apply_batches
  ADD COLUMN IF NOT EXISTS approval_request_key text,
  ADD COLUMN IF NOT EXISTS start_cursor integer,
  ADD COLUMN IF NOT EXISTS attempt_token uuid;

-- Preserve the immutable approval closure represented by pre-contract batches,
-- then retire their active execution row. A fresh bounded `request:cursor`
-- batch can subsequently claim the durable approval without colliding with the
-- one-active-batch index or reusing an unfenced worker lease.
INSERT INTO act_replacement_approval_requests (
  request_key, run_id, manifest_digest, selected_operation_ids,
  dependency_closed_operation_ids, selected_count, dependency_count,
  rejected_count, created_at, updated_at
)
SELECT
  request_key, run_id, manifest_digest, selected_operation_ids,
  dependency_closed_operation_ids, selected_count, dependency_count,
  rejected_count, created_at, updated_at
FROM act_replacement_apply_batches
WHERE approval_request_key IS NULL
ON CONFLICT (run_id, request_key) DO NOTHING;

DROP INDEX IF EXISTS act_replacement_apply_batches_one_active_per_run;

UPDATE act_replacement_apply_batches
SET state = 'complete_with_issues',
    lease_owner = NULL,
    lease_expires_at = NULL,
    attempt_token = NULL,
    last_error_code = 'legacy_approval_batch_retired',
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
WHERE (approval_request_key IS NULL AND state IN ('queued', 'applying'))
   OR (state = 'applying' AND attempt_token IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_apply_batches_one_active_per_run
  ON act_replacement_apply_batches (run_id)
  WHERE state IN ('queued', 'applying');

ALTER TABLE act_replacement_apply_batches
  DROP CONSTRAINT IF EXISTS act_replacement_apply_batches_request_key_key,
  DROP CONSTRAINT IF EXISTS act_replacement_apply_batches_request_key_unique,
  DROP CONSTRAINT IF EXISTS act_replacement_apply_batches_run_request_key_unique;

ALTER TABLE act_replacement_apply_batches
  ADD CONSTRAINT act_replacement_apply_batches_run_request_key_unique
  UNIQUE (run_id, request_key);

ALTER TABLE act_replacement_apply_batches
  DROP CONSTRAINT IF EXISTS act_replacement_apply_batches_cursor_nonnegative;

ALTER TABLE act_replacement_apply_batches
  ADD CONSTRAINT act_replacement_apply_batches_cursor_nonnegative
  CHECK (start_cursor IS NULL OR start_cursor >= 0);

CREATE INDEX IF NOT EXISTS act_replacement_apply_batches_approval_cursor_idx
  ON act_replacement_apply_batches (run_id, approval_request_key, start_cursor, created_at);

ALTER TABLE act_replacement_apply_batches
  DROP CONSTRAINT IF EXISTS act_replacement_apply_batches_lease_consistency;

ALTER TABLE act_replacement_apply_batches
  ADD CONSTRAINT act_replacement_apply_batches_lease_consistency
  CHECK (
    (state = 'applying' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND attempt_token IS NOT NULL)
    OR (state <> 'applying' AND attempt_token IS NULL)
  );

ALTER TABLE act_replacement_outcomes
  ADD COLUMN IF NOT EXISTS organized_at timestamptz;

-- Production owner identities are opaque strings (for example Clerk user IDs),
-- not necessarily UUIDs. Preserve any legacy UUID audit values as text.
ALTER TABLE act_replacement_review_decisions
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_supersession_requires_actor;

ALTER TABLE act_replacement_review_decisions
  ALTER COLUMN superseded_by TYPE text USING superseded_by::text;

ALTER TABLE act_replacement_review_decisions
  ADD CONSTRAINT act_replacement_review_decisions_supersession_requires_actor
  CHECK (superseded_at IS NULL OR (superseded_by IS NOT NULL AND btrim(superseded_by) <> ''));

ALTER TABLE act_replacement_runs
  ADD COLUMN IF NOT EXISTS organizer_token uuid,
  ADD COLUMN IF NOT EXISTS organizer_lease_expires_at timestamptz;

-- Rows left in organizing before leases existed have no exclusive owner and
-- could otherwise be stuck forever. Expired leases are also safe to re-run.
UPDATE act_replacement_runs
SET phase = 'extract_complete',
    organizer_token = NULL,
    organizer_lease_expires_at = NULL,
    updated_at = now()
WHERE phase = 'organizing'
  AND (organizer_token IS NULL OR organizer_lease_expires_at IS NULL OR organizer_lease_expires_at <= now());

ALTER TABLE act_replacement_runs
  DROP CONSTRAINT IF EXISTS act_replacement_runs_organizer_lease_consistency;

ALTER TABLE act_replacement_runs
  ADD CONSTRAINT act_replacement_runs_organizer_lease_consistency
  CHECK ((organizer_token IS NULL) = (organizer_lease_expires_at IS NULL));

CREATE INDEX IF NOT EXISTS act_replacement_runs_organizer_lease_idx
  ON act_replacement_runs (phase, organizer_lease_expires_at)
  WHERE phase = 'organizing';
