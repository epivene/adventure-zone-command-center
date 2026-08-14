DO $$
BEGIN
  IF to_regclass(current_schema() || '.act_archive_profile_import_jobs') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE act_archive_profile_import_jobs IN EXCLUSIVE MODE';
  END IF;
END $$;

ALTER TABLE act_external_links
  DROP CONSTRAINT IF EXISTS act_external_links_contact_primary_sync_valid;

ALTER TABLE act_external_links
  ADD CONSTRAINT act_external_links_contact_primary_sync_valid CHECK (
    (
      entity_type = 'contact' AND source_entity_type = 'contact' AND (
        (is_primary = true AND sync_mode = 'two_way')
        OR (is_primary = false AND sync_mode = 'pull_only')
        OR (is_primary = true AND sync_mode = 'pull_only' AND source_database_key IS NOT NULL AND source_record_id IS NOT NULL)
      )
    )
    OR (entity_type <> 'contact' AND sync_mode = 'pull_only')
  );

ALTER TABLE act_external_links
  DROP CONSTRAINT IF EXISTS act_external_links_archive_source_scope_fk;

ALTER TABLE act_external_links
  ADD CONSTRAINT act_external_links_archive_source_scope_fk
  FOREIGN KEY (source_record_id, source_database_key, source_entity_type)
  REFERENCES act_source_records(id, source_database_key, stream_type);

CREATE TABLE IF NOT EXISTS act_archive_profile_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES act_replacement_runs(id) ON DELETE CASCADE,
  source_database_key text NOT NULL,
  request_key text NOT NULL,
  requested_by text NOT NULL,
  phase text NOT NULL DEFAULT 'companies',
  cursor_source_record_id uuid,
  eligible_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  linked_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  already_imported_count integer NOT NULL DEFAULT 0,
  preserved_count integer NOT NULL DEFAULT 0,
  retryable_failure_count integer NOT NULL DEFAULT 0,
  retry_after timestamptz,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id),
  UNIQUE (run_id, request_key),
  FOREIGN KEY (run_id, source_database_key)
    REFERENCES act_replacement_runs(id, source_database_key),
  CHECK (phase IN ('companies','contacts','complete','failed')),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((lease_token IS NULL) = (lease_owner IS NULL)),
  CHECK (btrim(request_key) <> '' AND btrim(requested_by) <> ''),
  CHECK (eligible_count >= 0 AND processed_count >= 0),
  CHECK (created_count >= 0 AND linked_count >= 0 AND updated_count >= 0),
  CHECK (already_imported_count >= 0 AND preserved_count >= 0 AND retryable_failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS act_archive_profile_import_jobs_claim_idx
  ON act_archive_profile_import_jobs (phase, lease_expires_at, updated_at)
  WHERE phase IN ('companies','contacts');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'act_archive_profile_import_jobs'::regclass
      AND conname = 'act_archive_profile_import_jobs_id_database_unique'
  ) THEN
    ALTER TABLE act_archive_profile_import_jobs
      ADD CONSTRAINT act_archive_profile_import_jobs_id_database_unique
      UNIQUE (id, source_database_key);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS act_archive_profile_import_sources (
  job_id uuid NOT NULL,
  source_database_key text NOT NULL,
  source_record_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  phase text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_archive_profile_import_sources_pkey PRIMARY KEY (job_id, source_record_id),
  CONSTRAINT act_archive_profile_import_sources_job_id_fk
    FOREIGN KEY (job_id) REFERENCES act_archive_profile_import_jobs(id) ON DELETE CASCADE,
  CONSTRAINT act_archive_profile_import_sources_source_record_id_fk
    FOREIGN KEY (source_record_id) REFERENCES act_source_records(id) ON DELETE CASCADE,
  CONSTRAINT act_archive_profile_import_sources_source_version_id_fk
    FOREIGN KEY (source_version_id) REFERENCES act_source_record_versions(id) ON DELETE CASCADE,
  CONSTRAINT act_archive_profile_import_sources_job_database_fk
    FOREIGN KEY (job_id, source_database_key)
    REFERENCES act_archive_profile_import_jobs(id, source_database_key),
  CONSTRAINT act_archive_profile_import_sources_source_database_fk
    FOREIGN KEY (source_record_id, source_database_key)
    REFERENCES act_source_records(id, source_database_key),
  CONSTRAINT act_archive_profile_import_sources_version_owner_fk
    FOREIGN KEY (source_version_id, source_record_id)
    REFERENCES act_source_record_versions(id, source_record_id),
  CONSTRAINT act_archive_profile_import_sources_phase_valid
    CHECK (phase IN ('companies','contacts'))
);

CREATE INDEX IF NOT EXISTS act_archive_profile_import_sources_job_phase_source_idx
  ON act_archive_profile_import_sources (job_id, phase, source_record_id);

CREATE TABLE IF NOT EXISTS act_archive_profile_import_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES act_archive_profile_import_jobs(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES act_source_records(id) ON DELETE RESTRICT,
  source_version_id uuid NOT NULL REFERENCES act_source_record_versions(id) ON DELETE RESTRICT,
  status text NOT NULL,
  target_entity_type text,
  target_entity_id uuid,
  reason_code text,
  resolution_policy_version text NOT NULL,
  ai_provider text,
  ai_confidence text,
  evidence_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  retry_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, source_record_id),
  CHECK (status IN ('created','linked','updated','already_imported','preserved','retryable_failed')),
  CHECK (target_entity_type IS NULL OR target_entity_type IN ('organization','contact')),
  CHECK ((target_entity_type IS NULL) = (target_entity_id IS NULL)),
  CHECK (ai_confidence IS NULL OR ai_confidence IN ('high','medium','low')),
  CHECK (jsonb_typeof(evidence_labels) = 'array')
);

-- Legacy-safe reconstruction: a result is the only exact evidence that a
-- source/version belonged to a job before frozen membership existed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'act_archive_profile_import_jobs'
      AND column_name = 'membership_snapshot_version'
  ) THEN
    INSERT INTO act_archive_profile_import_sources
      (job_id, source_database_key, source_record_id, source_version_id, phase)
    SELECT jobs.id, jobs.source_database_key, results.source_record_id,
      results.source_version_id,
      CASE source.stream_type WHEN 'company' THEN 'companies' ELSE 'contacts' END
    FROM act_archive_profile_import_jobs jobs
    JOIN act_archive_profile_import_results results ON results.job_id = jobs.id
    JOIN act_source_records source
      ON source.id = results.source_record_id
      AND source.source_database_key = jobs.source_database_key
    WHERE jobs.membership_snapshot_version IS NULL
      AND source.stream_type IN ('company', 'contact')
    ON CONFLICT (job_id, source_record_id) DO NOTHING;
  ELSE
    INSERT INTO act_archive_profile_import_sources
      (job_id, source_database_key, source_record_id, source_version_id, phase)
    SELECT jobs.id, jobs.source_database_key, results.source_record_id,
      results.source_version_id,
      CASE source.stream_type WHEN 'company' THEN 'companies' ELSE 'contacts' END
    FROM act_archive_profile_import_jobs jobs
    JOIN act_archive_profile_import_results results ON results.job_id = jobs.id
    JOIN act_source_records source
      ON source.id = results.source_record_id
      AND source.source_database_key = jobs.source_database_key
    WHERE source.stream_type IN ('company', 'contact')
    ON CONFLICT (job_id, source_record_id) DO NOTHING;
  END IF;
END $$;
