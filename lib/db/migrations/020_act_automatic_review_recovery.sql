BEGIN;

ALTER TABLE act_replacement_bulk_review_requests
  ADD COLUMN IF NOT EXISTS expected_manifest_digest text,
  ADD COLUMN IF NOT EXISTS automatic_summary jsonb,
  ADD COLUMN IF NOT EXISTS rebuild_state text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS rebuild_token uuid,
  ADD COLUMN IF NOT EXISTS rebuild_lease_expires_at timestamptz;

UPDATE act_replacement_bulk_review_requests
SET rebuild_state = 'pending'
WHERE manifest_digest = '__pending_review_rebuild__'
  AND rebuild_state = 'complete';

ALTER TABLE act_replacement_bulk_review_requests
  DROP CONSTRAINT IF EXISTS act_replacement_bulk_review_requests_expected_digest_nonblank,
  ADD CONSTRAINT act_replacement_bulk_review_requests_expected_digest_nonblank
    CHECK (expected_manifest_digest IS NULL OR btrim(expected_manifest_digest) <> ''),
  DROP CONSTRAINT IF EXISTS act_replacement_bulk_review_requests_rebuild_state_valid,
  ADD CONSTRAINT act_replacement_bulk_review_requests_rebuild_state_valid
    CHECK (rebuild_state IN ('pending', 'rebuilding', 'complete')),
  DROP CONSTRAINT IF EXISTS act_replacement_bulk_review_requests_rebuild_lease_valid,
  ADD CONSTRAINT act_replacement_bulk_review_requests_rebuild_lease_valid
    CHECK (
      rebuild_state = 'rebuilding'
        AND rebuild_token IS NOT NULL
        AND rebuild_lease_expires_at IS NOT NULL
      OR rebuild_state <> 'rebuilding'
        AND rebuild_token IS NULL
        AND rebuild_lease_expires_at IS NULL
    );

COMMIT;
