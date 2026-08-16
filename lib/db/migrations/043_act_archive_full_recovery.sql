-- Durable archive-first ACT recovery ledger.
-- Recovery is additive and restart-safe; source snapshots are frozen per run.

CREATE TABLE IF NOT EXISTS act_archive_recovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_database_key text NOT NULL,
  requested_by text NOT NULL,
  request_key text NOT NULL,
  state text NOT NULL DEFAULT 'running',
  candidate_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_archive_recovery_runs_database_request_unique
    UNIQUE (source_database_key, request_key),
  CONSTRAINT act_archive_recovery_runs_state_valid
    CHECK (state IN ('running','complete','failed')),
  CONSTRAINT act_archive_recovery_runs_database_nonblank
    CHECK (btrim(source_database_key) <> ''),
  CONSTRAINT act_archive_recovery_runs_actor_nonblank
    CHECK (btrim(requested_by) <> '' AND btrim(request_key) <> ''),
  CONSTRAINT act_archive_recovery_runs_candidate_count_nonnegative
    CHECK (candidate_count >= 0)
);

CREATE TABLE IF NOT EXISTS act_archive_recovery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_archive_recovery_runs(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES act_source_records(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id),
  stream_type text NOT NULL,
  priority integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  target_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  retry_after timestamptz,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_archive_recovery_items_run_source_unique
    UNIQUE (run_id, source_record_id),
  CONSTRAINT act_archive_recovery_items_version_owner_fk
    FOREIGN KEY (source_version_id, source_record_id)
    REFERENCES act_source_record_versions(id, source_record_id),
  CONSTRAINT act_archive_recovery_items_state_valid CHECK (state IN (
    'pending','leased','already_present','recovered','needs_review',
    'dropped_unusable','retryable_failed'
  )),
  CONSTRAINT act_archive_recovery_items_target_summary_object
    CHECK (jsonb_typeof(target_summary) = 'object'),
  CONSTRAINT act_archive_recovery_items_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  CONSTRAINT act_archive_recovery_items_lease_consistency CHECK (
    (lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR
    (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS act_archive_recovery_items_claim_idx
  ON act_archive_recovery_items (state, retry_after, priority, source_record_id);

CREATE TABLE IF NOT EXISTS act_archive_recovery_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_archive_recovery_runs(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES act_source_records(id),
  source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id),
  decision text NOT NULL,
  target_entity_type text,
  target_entity_id uuid,
  decided_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_archive_recovery_decisions_version_owner_fk
    FOREIGN KEY (source_version_id, source_record_id)
    REFERENCES act_source_record_versions(id, source_record_id),
  CONSTRAINT act_archive_recovery_decisions_decision_valid
    CHECK (decision IN ('assign_parent','drop_unusable','retry')),
  CONSTRAINT act_archive_recovery_decisions_target_type_valid
    CHECK (target_entity_type IS NULL OR target_entity_type IN (
      'organization','contact','booking','calling_list','activity'
    )),
  CONSTRAINT act_archive_recovery_decisions_target_pair_valid
    CHECK ((target_entity_type IS NULL) = (target_entity_id IS NULL)),
  CONSTRAINT act_archive_recovery_decisions_actor_nonblank
    CHECK (btrim(decided_by) <> '')
);

CREATE INDEX IF NOT EXISTS act_archive_recovery_decisions_source_idx
  ON act_archive_recovery_decisions (run_id, source_record_id, created_at DESC);

-- Keep startup replays safe if this migration runs after a partial deployment.
ALTER TABLE act_archive_recovery_items
  ALTER COLUMN target_summary SET DEFAULT '{}'::jsonb;

ALTER TABLE act_archive_recovery_runs
  ALTER COLUMN state SET DEFAULT 'running';

ALTER TABLE act_archive_recovery_items
  ALTER COLUMN state SET DEFAULT 'pending';

ALTER TABLE act_archive_recovery_items
  ALTER COLUMN attempt_count SET DEFAULT 0;

ALTER TABLE act_archive_recovery_runs
  ALTER COLUMN candidate_count SET DEFAULT 0;

-- Marker-friendly no-op checks above intentionally leave existing rows untouched.
