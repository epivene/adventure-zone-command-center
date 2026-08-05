-- Durable, preview-only Act! replacement extraction state and permanent archive.
-- This migration only adds replacement tables; all legacy migration/import
-- tables remain intact for rollback and historical access.

CREATE TABLE IF NOT EXISTS act_replacement_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL,
  source_database_key text NOT NULL,
  requested_by text NOT NULL,
  page_size integer NOT NULL,
  preview_only boolean NOT NULL DEFAULT true,
  phase text NOT NULL DEFAULT 'extracting',
  summary jsonb,
  last_error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  extract_completed_at timestamptz,
  completed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_replacement_runs_request_key_nonblank
    CHECK (btrim(request_key) <> ''),
  CONSTRAINT act_replacement_runs_source_database_key_nonblank
    CHECK (btrim(source_database_key) <> ''),
  CONSTRAINT act_replacement_runs_requested_by_nonblank
    CHECK (btrim(requested_by) <> ''),
  CONSTRAINT act_replacement_runs_page_size_valid
    CHECK (page_size IN (25, 50, 100, 200)),
  CONSTRAINT act_replacement_runs_phase_valid
    CHECK (phase IN (
      'extracting', 'extract_complete', 'organizing', 'ready_to_apply',
      'applying', 'complete', 'complete_with_issues', 'failed', 'superseded'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_runs_database_request_unique
  ON act_replacement_runs (source_database_key, request_key);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_runs_id_database_unique
  ON act_replacement_runs (id, source_database_key);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_runs_one_active_per_database
  ON act_replacement_runs (source_database_key)
  WHERE phase IN (
    'extracting', 'extract_complete', 'organizing', 'ready_to_apply', 'applying'
  );

CREATE TABLE IF NOT EXISTS act_source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_database_key text NOT NULL,
  stream_type text NOT NULL,
  source_key text NOT NULL,
  act_record_id text,
  first_seen_run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
  last_seen_run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
  latest_version_id uuid,
  latest_fingerprint text,
  relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  archive_completeness text NOT NULL DEFAULT 'discovered',
  normalization_status text NOT NULL DEFAULT 'pending',
  linking_status text NOT NULL DEFAULT 'pending',
  error_code text,
  unsupported_reason text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_source_records_source_database_key_nonblank
    CHECK (btrim(source_database_key) <> ''),
  CONSTRAINT act_source_records_stream_type_valid
    CHECK (stream_type IN (
      'company', 'contact', 'opportunity', 'group',
      'company_contact', 'opportunity_company', 'opportunity_contact', 'group_contact',
      'activity', 'note', 'history',
      'activity_contact', 'activity_company', 'activity_opportunity',
      'note_contact', 'note_company', 'note_opportunity',
      'history_contact', 'history_company', 'history_opportunity'
    )),
  CONSTRAINT act_source_records_source_key_nonblank
    CHECK (btrim(source_key) <> ''),
  CONSTRAINT act_source_records_act_record_id_nonblank
    CHECK (act_record_id IS NULL OR btrim(act_record_id) <> ''),
  CONSTRAINT act_source_records_latest_fingerprint_nonblank
    CHECK (latest_fingerprint IS NULL OR btrim(latest_fingerprint) <> ''),
  CONSTRAINT act_source_records_latest_version_pair_valid
    CHECK ((latest_version_id IS NULL) = (latest_fingerprint IS NULL)),
  CONSTRAINT act_source_records_relationship_evidence_object
    CHECK (jsonb_typeof(relationship_evidence) = 'object'),
  CONSTRAINT act_source_records_archive_completeness_valid
    CHECK (archive_completeness IN ('discovered', 'complete', 'partial', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS act_source_records_database_stream_source_key_unique
  ON act_source_records (source_database_key, stream_type, source_key);

CREATE UNIQUE INDEX IF NOT EXISTS act_source_records_database_stream_act_id_unique
  ON act_source_records (source_database_key, stream_type, act_record_id)
  WHERE act_record_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS act_source_records_id_database_unique
  ON act_source_records (id, source_database_key);

CREATE UNIQUE INDEX IF NOT EXISTS act_source_records_id_database_stream_unique
  ON act_source_records (id, source_database_key, stream_type);

CREATE TABLE IF NOT EXISTS act_source_record_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id uuid NOT NULL REFERENCES act_source_records(id),
  source_database_key text NOT NULL,
  fingerprint text NOT NULL,
  raw_snapshot jsonb NOT NULL,
  snapshot_scope text NOT NULL,
  source_created_at timestamptz,
  source_edited_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  observed_run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_source_record_versions_fingerprint_nonblank
    CHECK (btrim(fingerprint) <> ''),
  CONSTRAINT act_source_record_versions_raw_snapshot_object
    CHECK (jsonb_typeof(raw_snapshot) = 'object'),
  CONSTRAINT act_source_record_versions_snapshot_scope_valid
    CHECK (snapshot_scope IN ('list_projected', 'list_plain', 'detail', 'relationship'))
);

CREATE UNIQUE INDEX IF NOT EXISTS act_source_record_versions_record_fingerprint_unique
  ON act_source_record_versions (source_record_id, fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS act_source_record_versions_id_source_unique
  ON act_source_record_versions (id, source_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS act_source_record_versions_id_source_fingerprint_unique
  ON act_source_record_versions (id, source_record_id, fingerprint);

CREATE INDEX IF NOT EXISTS act_source_record_versions_observed_run_idx
  ON act_source_record_versions (observed_run_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_source_records_latest_version_fk'
      AND conrelid = 'act_source_records'::regclass
  ) THEN
    ALTER TABLE act_source_records
      ADD CONSTRAINT act_source_records_latest_version_fk
      FOREIGN KEY (latest_version_id) REFERENCES act_source_record_versions(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_source_records_first_seen_run_database_fk'
      AND conrelid = 'act_source_records'::regclass
  ) THEN
    ALTER TABLE act_source_records
      ADD CONSTRAINT act_source_records_first_seen_run_database_fk
      FOREIGN KEY (first_seen_run_id, source_database_key)
      REFERENCES act_replacement_runs(id, source_database_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_source_records_last_seen_run_database_fk'
      AND conrelid = 'act_source_records'::regclass
  ) THEN
    ALTER TABLE act_source_records
      ADD CONSTRAINT act_source_records_last_seen_run_database_fk
      FOREIGN KEY (last_seen_run_id, source_database_key)
      REFERENCES act_replacement_runs(id, source_database_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_source_records_latest_version_owner_fk'
      AND conrelid = 'act_source_records'::regclass
  ) THEN
    ALTER TABLE act_source_records
      ADD CONSTRAINT act_source_records_latest_version_owner_fk
      FOREIGN KEY (latest_version_id, id, latest_fingerprint)
      REFERENCES act_source_record_versions(id, source_record_id, fingerprint);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_source_record_versions_source_database_fk'
      AND conrelid = 'act_source_record_versions'::regclass
  ) THEN
    ALTER TABLE act_source_record_versions
      ADD CONSTRAINT act_source_record_versions_source_database_fk
      FOREIGN KEY (source_record_id, source_database_key)
      REFERENCES act_source_records(id, source_database_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'act_source_record_versions_observed_run_database_fk'
      AND conrelid = 'act_source_record_versions'::regclass
  ) THEN
    ALTER TABLE act_source_record_versions
      ADD CONSTRAINT act_source_record_versions_observed_run_database_fk
      FOREIGN KEY (observed_run_id, source_database_key)
      REFERENCES act_replacement_runs(id, source_database_key);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS act_replacement_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
  source_database_key text NOT NULL,
  stream_type text NOT NULL,
  checkpoint_kind text NOT NULL,
  partition_key text NOT NULL,
  requiredness text NOT NULL,
  parent_source_record_id uuid REFERENCES act_source_records(id),
  parent_act_record_id text,
  source_record_id uuid REFERENCES act_source_records(id),
  next_skip integer NOT NULL DEFAULT 0,
  page_size integer NOT NULL,
  query_mode text NOT NULL DEFAULT 'projected',
  derive_details boolean NOT NULL DEFAULT true,
  state text NOT NULL DEFAULT 'pending',
  lease_owner text,
  lease_expires_at timestamptz,
  retry_after timestamptz,
  retryable boolean NOT NULL DEFAULT true,
  attempt_count integer NOT NULL DEFAULT 0,
  response_rows integer NOT NULL DEFAULT 0,
  observed_identities integer NOT NULL DEFAULT 0,
  archived_identities integer NOT NULL DEFAULT 0,
  complete_identities integer NOT NULL DEFAULT 0,
  partial_identities integer NOT NULL DEFAULT 0,
  failed_identities integer NOT NULL DEFAULT 0,
  snapshot_versions_inserted integer NOT NULL DEFAULT 0,
  error_code text,
  last_succeeded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_replacement_checkpoints_stream_type_valid
    CHECK (stream_type IN (
      'company', 'contact', 'opportunity', 'group',
      'company_contact', 'opportunity_company', 'opportunity_contact', 'group_contact',
      'activity', 'note', 'history',
      'activity_contact', 'activity_company', 'activity_opportunity',
      'note_contact', 'note_company', 'note_opportunity',
      'history_contact', 'history_company', 'history_opportunity'
    )),
  CONSTRAINT act_replacement_checkpoints_kind_valid
    CHECK (checkpoint_kind IN ('list', 'plain_list_fallback', 'detail', 'relationship')),
  CONSTRAINT act_replacement_checkpoints_requiredness_valid
    CHECK (requiredness IN ('required', 'optional_capability')),
  CONSTRAINT act_replacement_checkpoints_partition_key_nonblank
    CHECK (btrim(partition_key) <> ''),
  CONSTRAINT act_replacement_checkpoints_query_mode_valid
    CHECK (query_mode IN ('projected', 'plain')),
  CONSTRAINT act_replacement_checkpoints_state_valid
    CHECK (state IN ('pending', 'leased', 'retry_wait', 'complete', 'unsupported', 'failed')),
  CONSTRAINT act_replacement_checkpoints_next_skip_nonnegative
    CHECK (next_skip >= 0),
  CONSTRAINT act_replacement_checkpoints_page_size_positive
    CHECK (page_size > 0),
  CONSTRAINT act_replacement_checkpoints_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  CONSTRAINT act_replacement_checkpoints_counters_nonnegative
    CHECK (
      response_rows >= 0 AND observed_identities >= 0 AND archived_identities >= 0
      AND complete_identities >= 0 AND partial_identities >= 0
      AND failed_identities >= 0 AND snapshot_versions_inserted >= 0
    ),
  CONSTRAINT act_replacement_checkpoints_run_database_fk
    FOREIGN KEY (run_id, source_database_key)
    REFERENCES act_replacement_runs(id, source_database_key),
  CONSTRAINT act_replacement_checkpoints_parent_source_database_fk
    FOREIGN KEY (parent_source_record_id, source_database_key)
    REFERENCES act_source_records(id, source_database_key),
  CONSTRAINT act_replacement_checkpoints_source_database_stream_fk
    FOREIGN KEY (source_record_id, source_database_key, stream_type)
    REFERENCES act_source_records(id, source_database_key, stream_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_checkpoints_run_stream_partition_unique
  ON act_replacement_checkpoints (run_id, stream_type, partition_key);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_checkpoints_context_unique
  ON act_replacement_checkpoints (id, run_id, source_database_key, stream_type);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_checkpoints_request_context_unique
  ON act_replacement_checkpoints (id, run_id, stream_type);

CREATE INDEX IF NOT EXISTS act_replacement_checkpoints_claim_idx
  ON act_replacement_checkpoints (state, retry_after, lease_expires_at);

CREATE TABLE IF NOT EXISTS act_replacement_page_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
  checkpoint_id uuid NOT NULL REFERENCES act_replacement_checkpoints(id),
  stream_type text NOT NULL,
  page_skip integer NOT NULL,
  next_skip integer,
  query_mode text NOT NULL,
  page_fingerprint text NOT NULL,
  response_rows integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_replacement_page_receipts_page_skip_nonnegative
    CHECK (page_skip >= 0),
  CONSTRAINT act_replacement_page_receipts_next_skip_nonnegative
    CHECK (next_skip IS NULL OR next_skip >= 0),
  CONSTRAINT act_replacement_page_receipts_query_mode_valid
    CHECK (query_mode IN ('projected', 'plain')),
  CONSTRAINT act_replacement_page_receipts_fingerprint_nonblank
    CHECK (btrim(page_fingerprint) <> ''),
  CONSTRAINT act_replacement_page_receipts_response_rows_nonnegative
    CHECK (response_rows >= 0),
  CONSTRAINT act_replacement_page_receipts_checkpoint_context_fk
    FOREIGN KEY (checkpoint_id, run_id, stream_type)
    REFERENCES act_replacement_checkpoints(id, run_id, stream_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_page_receipts_checkpoint_cursor_unique
  ON act_replacement_page_receipts (checkpoint_id, page_skip);

CREATE TABLE IF NOT EXISTS act_replacement_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
  source_database_key text NOT NULL,
  source_record_id uuid NOT NULL REFERENCES act_source_records(id),
  version_id uuid NOT NULL REFERENCES act_source_record_versions(id),
  snapshot_scope text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_replacement_observations_snapshot_scope_valid
    CHECK (snapshot_scope IN ('list_projected', 'list_plain', 'detail', 'relationship')),
  CONSTRAINT act_replacement_observations_run_database_fk
    FOREIGN KEY (run_id, source_database_key)
    REFERENCES act_replacement_runs(id, source_database_key),
  CONSTRAINT act_replacement_observations_source_database_fk
    FOREIGN KEY (source_record_id, source_database_key)
    REFERENCES act_source_records(id, source_database_key),
  CONSTRAINT act_replacement_observations_version_source_fk
    FOREIGN KEY (version_id, source_record_id)
    REFERENCES act_source_record_versions(id, source_record_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_observations_run_source_unique
  ON act_replacement_observations (run_id, source_record_id);

CREATE TABLE IF NOT EXISTS act_replacement_request_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
  checkpoint_id uuid NOT NULL REFERENCES act_replacement_checkpoints(id),
  stream_type text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  path_template text NOT NULL,
  state text NOT NULL DEFAULT 'started',
  http_status integer,
  safe_error_code text,
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT act_replacement_request_audits_method_get_only
    CHECK (method = 'GET'),
  CONSTRAINT act_replacement_request_audits_stream_type_valid
    CHECK (stream_type IN (
      'company', 'contact', 'opportunity', 'group',
      'company_contact', 'opportunity_company', 'opportunity_contact', 'group_contact',
      'activity', 'note', 'history',
      'activity_contact', 'activity_company', 'activity_opportunity',
      'note_contact', 'note_company', 'note_opportunity',
      'history_contact', 'history_company', 'history_opportunity'
    )),
  CONSTRAINT act_replacement_request_audits_path_template_safe
    CHECK (path_template = '/authorize' OR path_template ~ '^/api/[A-Za-z0-9_{}:-]+(/[A-Za-z0-9_{}:-]+)*$'),
  CONSTRAINT act_replacement_request_audits_state_valid
    CHECK (state IN ('started', 'succeeded', 'failed')),
  CONSTRAINT act_replacement_request_audits_http_status_valid
    CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  CONSTRAINT act_replacement_request_audits_duration_nonnegative
    CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT act_replacement_request_audits_safe_error_code_valid
    CHECK (safe_error_code IS NULL OR safe_error_code IN (
      'not_configured', 'authentication_failed', 'permission_denied',
      'query_rejected', 'not_found', 'endpoint_unsupported', 'rate_limited',
      'timeout', 'unavailable', 'invalid_response', 'pagination_stalled'
    )),
  CONSTRAINT act_replacement_request_audits_checkpoint_context_fk
    FOREIGN KEY (checkpoint_id, run_id, stream_type)
    REFERENCES act_replacement_checkpoints(id, run_id, stream_type)
);

CREATE OR REPLACE FUNCTION reject_act_archive_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('%I is insert-only', TG_TABLE_NAME);
END;
$$;

DROP TRIGGER IF EXISTS act_source_record_versions_immutable
  ON act_source_record_versions;
CREATE TRIGGER act_source_record_versions_immutable
  BEFORE UPDATE OR DELETE ON act_source_record_versions
  FOR EACH ROW EXECUTE FUNCTION reject_act_archive_mutation();

DROP TRIGGER IF EXISTS act_replacement_page_receipts_immutable
  ON act_replacement_page_receipts;
CREATE TRIGGER act_replacement_page_receipts_immutable
  BEFORE UPDATE OR DELETE ON act_replacement_page_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_act_archive_mutation();
