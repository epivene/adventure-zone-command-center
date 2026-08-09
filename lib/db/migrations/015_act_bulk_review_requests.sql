BEGIN;

CREATE TABLE IF NOT EXISTS act_replacement_bulk_review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_replacement_runs(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  request_fingerprint text NOT NULL,
  requested_by text NOT NULL,
  manifest_digest text NOT NULL,
  decision_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_operation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, request_key),
  CONSTRAINT act_replacement_bulk_review_requests_key_nonblank CHECK (btrim(request_key) <> ''),
  CONSTRAINT act_replacement_bulk_review_requests_fingerprint_nonblank CHECK (btrim(request_fingerprint) <> ''),
  CONSTRAINT act_replacement_bulk_review_requests_actor_nonblank CHECK (btrim(requested_by) <> ''),
  CONSTRAINT act_replacement_bulk_review_requests_digest_nonblank CHECK (btrim(manifest_digest) <> ''),
  CONSTRAINT act_replacement_bulk_review_requests_decision_ids_array CHECK (jsonb_typeof(decision_ids) = 'array'),
  CONSTRAINT act_replacement_bulk_review_requests_operation_ids_array CHECK (jsonb_typeof(reviewed_operation_ids) = 'array')
);

COMMIT;
