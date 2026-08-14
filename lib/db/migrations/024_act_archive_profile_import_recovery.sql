BEGIN;

ALTER TABLE act_archive_profile_import_jobs
  ADD COLUMN IF NOT EXISTS membership_snapshot_version integer,
  ADD COLUMN IF NOT EXISTS failure_attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE act_archive_profile_import_jobs
  ALTER COLUMN membership_snapshot_version DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'act_archive_profile_import_jobs'::regclass
      AND conname = 'act_archive_profile_import_jobs_failure_attempt_nonnegative'
  ) THEN
    ALTER TABLE act_archive_profile_import_jobs
      ADD CONSTRAINT act_archive_profile_import_jobs_failure_attempt_nonnegative
      CHECK (failure_attempt_count >= 0);
  END IF;
END $$;

-- Block claims/final job updates while the reset spans results, membership,
-- and counters. This waits for in-flight workers before classifying leases.
LOCK TABLE act_archive_profile_import_jobs IN EXCLUSIVE MODE;

UPDATE act_archive_profile_import_jobs
SET membership_snapshot_version = 2
WHERE phase = 'complete'
  AND membership_snapshot_version IS NULL;

CREATE TEMP TABLE act_archive_profile_import_recovery_jobs
  ON COMMIT DROP AS
SELECT id
FROM act_archive_profile_import_jobs
WHERE phase <> 'complete'
  AND membership_snapshot_version IS NULL
  AND (retry_after IS NULL OR retry_after <= clock_timestamp())
  AND (
    lease_token IS NULL
    OR lease_expires_at <= clock_timestamp()
  );

DELETE FROM act_archive_profile_import_results results
USING act_archive_profile_import_recovery_jobs recovery
WHERE results.job_id = recovery.id;

DELETE FROM act_archive_profile_import_sources membership
USING act_archive_profile_import_recovery_jobs recovery
WHERE membership.job_id = recovery.id;

UPDATE act_archive_profile_import_jobs jobs
SET phase = 'companies', cursor_source_record_id = NULL,
  eligible_count = 0, processed_count = 0, created_count = 0,
  linked_count = 0, updated_count = 0, already_imported_count = 0,
  preserved_count = 0, retryable_failure_count = 0,
  retry_after = NULL, lease_owner = NULL, lease_token = NULL,
  lease_expires_at = NULL, last_error_code = NULL, completed_at = NULL,
  failure_attempt_count = 0, updated_at = clock_timestamp()
FROM act_archive_profile_import_recovery_jobs recovery
WHERE jobs.id = recovery.id;

INSERT INTO act_archive_profile_import_sources
  (job_id, source_database_key, source_record_id, source_version_id, phase)
SELECT jobs.id, jobs.source_database_key, source.id, source.latest_version_id,
  CASE source.stream_type WHEN 'company' THEN 'companies' ELSE 'contacts' END
FROM act_archive_profile_import_jobs jobs
JOIN act_archive_profile_import_recovery_jobs recovery ON recovery.id = jobs.id
JOIN act_source_records source
  ON source.source_database_key = jobs.source_database_key
WHERE source.stream_type IN ('company', 'contact')
  AND source.latest_version_id IS NOT NULL
ON CONFLICT (job_id, source_record_id) DO NOTHING;

UPDATE act_archive_profile_import_jobs jobs
SET eligible_count = (
    SELECT count(*)::integer
    FROM act_archive_profile_import_sources membership
    WHERE membership.job_id = jobs.id
  ),
  membership_snapshot_version = 2,
  updated_at = clock_timestamp()
FROM act_archive_profile_import_recovery_jobs recovery
WHERE jobs.id = recovery.id;

COMMIT;
