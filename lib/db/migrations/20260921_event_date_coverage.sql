CREATE TABLE IF NOT EXISTS event_date_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  status text NOT NULL,
  recurrence_rule jsonb,
  rationale text NOT NULL,
  source_kind text NOT NULL,
  source_title text NOT NULL,
  source_url text,
  source_record_type text,
  source_record_id text,
  source_pointers jsonb NOT NULL DEFAULT '[]'::jsonb,
  researched_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  superseded_by_id uuid,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_date_facts_organization_fk
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT event_date_facts_status_valid
    CHECK (status IN ('confirmed', 'expected', 'needs_review')),
  CONSTRAINT event_date_facts_source_kind_valid
    CHECK (source_kind IN ('internal', 'web', 'derived')),
  CONSTRAINT event_date_facts_range_valid
    CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'event_date_facts'::regclass
      AND conname = 'event_date_facts_superseded_by_fk'
  ) THEN
    ALTER TABLE event_date_facts
      ADD CONSTRAINT event_date_facts_superseded_by_fk
      FOREIGN KEY (superseded_by_id)
      REFERENCES event_date_facts(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS event_date_facts_one_active_per_org
  ON event_date_facts (organization_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS event_date_facts_effective_date_idx
  ON event_date_facts (organization_id, active, status, starts_on);

CREATE TABLE IF NOT EXISTS event_date_coverage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued',
  batch_size integer NOT NULL DEFAULT 25,
  requested_by text,
  selected_organization_ids jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_date_coverage_runs_status_valid
    CHECK (status IN ('queued', 'researching', 'complete', 'failed', 'cancelled')),
  CONSTRAINT event_date_coverage_runs_batch_size_positive
    CHECK (batch_size > 0)
);

CREATE INDEX IF NOT EXISTS event_date_coverage_runs_status_idx
  ON event_date_coverage_runs (status, created_at);

CREATE TABLE IF NOT EXISTS event_date_coverage_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  error_detail text,
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_date_coverage_items_run_fk
    FOREIGN KEY (run_id) REFERENCES event_date_coverage_runs(id) ON DELETE CASCADE,
  CONSTRAINT event_date_coverage_items_organization_fk
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT event_date_coverage_items_status_valid
    CHECK (status IN ('queued', 'researching', 'complete', 'needs_review', 'failed', 'skipped')),
  CONSTRAINT event_date_coverage_items_attempts_nonnegative
    CHECK (attempts >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS event_date_coverage_items_run_org_unique
  ON event_date_coverage_items (run_id, organization_id);

CREATE INDEX IF NOT EXISTS event_date_coverage_items_lease_idx
  ON event_date_coverage_items (status, lease_expires_at, created_at);
