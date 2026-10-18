-- Additive, opt-in synchronization state. Never cascade into business records.
CREATE TABLE IF NOT EXISTS google_sync_accounts (
 connection_id uuid PRIMARY KEY, email text NOT NULL,
 mode text NOT NULL DEFAULT 'off' CHECK(mode IN ('off','shadow','active')),
 cohort_limit integer NOT NULL DEFAULT 3 CHECK(cohort_limit>=0),
 epoch bigint NOT NULL DEFAULT 1, version bigint NOT NULL DEFAULT 0,
 checkpoint jsonb NOT NULL DEFAULT '{"phase":"boundary"}',
 lease_token uuid, lease_until timestamptz, retry_at timestamptz,
 last_success_at timestamptz, next_history_at timestamptz, error_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS google_sync_jobs (
 connection_id uuid NOT NULL, thread_id text NOT NULL,
 generation bigint NOT NULL DEFAULT 1, processed_generation bigint NOT NULL DEFAULT 0,
 claim_generation bigint, claim_token uuid, claim_epoch bigint, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(), error_code text,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(connection_id,thread_id)
);
CREATE INDEX IF NOT EXISTS google_sync_jobs_due ON google_sync_jobs(connection_id,retry_at,thread_id) WHERE generation>processed_generation;
CREATE TABLE IF NOT EXISTS google_sync_snapshots (
 connection_id uuid NOT NULL, thread_id text NOT NULL, profile_id uuid,
 state text NOT NULL, snapshot jsonb NOT NULL, fingerprint text NOT NULL,
 availability text NOT NULL DEFAULT 'available', checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,thread_id)
);
CREATE INDEX IF NOT EXISTS google_sync_snapshots_profile ON google_sync_snapshots(connection_id,profile_id,thread_id);
CREATE TABLE IF NOT EXISTS google_sync_history (
 connection_id uuid NOT NULL, thread_id text NOT NULL, fingerprint text NOT NULL,
 profile_id uuid, state text NOT NULL, snapshot jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,thread_id,fingerprint)
);
CREATE TABLE IF NOT EXISTS google_sync_archive_jobs (
 connection_id uuid NOT NULL, thread_id text NOT NULL, fingerprint text NOT NULL,
 profile_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending',
 retry_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
 error_code text, PRIMARY KEY(connection_id,thread_id,fingerprint)
);
CREATE TABLE IF NOT EXISTS google_sync_enrollments (
 connection_id uuid NOT NULL,profile_id uuid NOT NULL,PRIMARY KEY(connection_id,profile_id)
);
-- Existing mapping tables predate this additive migration. The conditional also
-- permits isolated queue tests to install the new tables independently.
CREATE OR REPLACE FUNCTION google_sync_mapping_changed() RETURNS trigger AS $$
BEGIN
 IF TG_OP='INSERT' AND COALESCE(NEW.evidence_codes,'[]'::jsonb) @> '["incremental_sync"]'::jsonb THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (OLD.connection_id,OLD.thread_id,OLD.organization_id) IS NOT DISTINCT FROM (NEW.connection_id,NEW.thread_id,NEW.organization_id) THEN RETURN NEW; END IF;
 INSERT INTO google_sync_jobs(connection_id,thread_id)
 SELECT NEW.connection_id,NEW.thread_id FROM google_sync_accounts a
 WHERE a.connection_id=NEW.connection_id AND a.mode<>'off' AND NEW.thread_id IS NOT NULL
 ON CONFLICT(connection_id,thread_id) DO UPDATE SET generation=google_sync_jobs.generation+1,retry_at=now(),updated_at=now();
 IF TG_OP='UPDATE' AND (OLD.connection_id,OLD.thread_id) IS DISTINCT FROM (NEW.connection_id,NEW.thread_id) THEN
  INSERT INTO google_sync_jobs(connection_id,thread_id)
  SELECT OLD.connection_id,OLD.thread_id FROM google_sync_accounts a
  WHERE a.connection_id=OLD.connection_id AND a.mode<>'off' AND OLD.thread_id IS NOT NULL
  ON CONFLICT(connection_id,thread_id) DO UPDATE SET generation=google_sync_jobs.generation+1,retry_at=now(),updated_at=now();
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$ BEGIN
 IF to_regclass('public.google_workspace_validation_mappings') IS NOT NULL THEN
  CREATE INDEX IF NOT EXISTS google_sync_mapping_thread ON google_workspace_validation_mappings(connection_id,thread_id,organization_id);
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='google_sync_mapping_changed_trigger' AND tgrelid='google_workspace_validation_mappings'::regclass) THEN
   CREATE TRIGGER google_sync_mapping_changed_trigger AFTER INSERT OR UPDATE ON google_workspace_validation_mappings FOR EACH ROW EXECUTE FUNCTION google_sync_mapping_changed();
  END IF;
 END IF;
END $$;
