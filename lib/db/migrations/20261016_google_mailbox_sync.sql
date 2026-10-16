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
