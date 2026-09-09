ALTER TABLE communication_templates
  ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'plain_text';

DO $$ BEGIN
  ALTER TABLE communication_templates
    ADD CONSTRAINT communication_templates_body_format_valid
    CHECK (body_format IN ('plain_text', 'html'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS boss_work_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  state text NOT NULL DEFAULT 'waiting_on_dave',
  priority text NOT NULL DEFAULT 'normal',
  title text NOT NULL,
  instructions text,
  due_at timestamptz,
  created_by_owner_id text,
  assigned_boss_account_id uuid NOT NULL REFERENCES boss_accounts(id) ON DELETE RESTRICT,
  deduplication_key text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boss_work_requests_type_valid CHECK (type IN ('rapid_convention_notes','email_template_approval')),
  CONSTRAINT boss_work_requests_state_valid CHECK (state IN ('waiting_on_dave','in_progress','submitted_to_owner','changes_requested','returned_for_clarification','approved','applied','cancelled')),
  CONSTRAINT boss_work_requests_priority_valid CHECK (priority IN ('normal','high','urgent'))
);
CREATE INDEX IF NOT EXISTS boss_work_requests_assignee_state_due_idx ON boss_work_requests (assigned_boss_account_id, state, due_at);
CREATE UNIQUE INDEX IF NOT EXISTS boss_work_requests_assignee_dedupe_unique ON boss_work_requests (assigned_boss_account_id, deduplication_key) WHERE deduplication_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS boss_work_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES boss_work_requests(id) ON DELETE CASCADE,
  actor_kind text NOT NULL,
  actor_id text,
  prior_state text,
  new_state text NOT NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boss_work_request_events_actor_valid CHECK (actor_kind IN ('system','owner','boss')),
  CONSTRAINT boss_work_request_events_new_state_valid CHECK (new_state IN ('waiting_on_dave','in_progress','submitted_to_owner','changes_requested','returned_for_clarification','approved','applied','cancelled')),
  CONSTRAINT boss_work_request_events_prior_state_valid CHECK (prior_state IS NULL OR prior_state IN ('waiting_on_dave','in_progress','submitted_to_owner','changes_requested','returned_for_clarification','approved','applied','cancelled'))
);
CREATE INDEX IF NOT EXISTS boss_work_request_events_request_created_idx ON boss_work_request_events (request_id, created_at);

CREATE TABLE IF NOT EXISTS boss_convention_drafts (
  request_id uuid NOT NULL REFERENCES boss_work_requests(id) ON DELETE CASCADE,
  boss_account_id uuid NOT NULL REFERENCES boss_accounts(id) ON DELETE CASCADE,
  client_revision integer NOT NULL DEFAULT 0 CHECK (client_revision >= 0),
  payload jsonb NOT NULL DEFAULT '{"eventName":""}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boss_convention_drafts_pk PRIMARY KEY (request_id, boss_account_id)
);

CREATE TABLE IF NOT EXISTS boss_convention_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES boss_work_requests(id) ON DELETE CASCADE,
  boss_account_id uuid NOT NULL REFERENCES boss_accounts(id) ON DELETE RESTRICT,
  client_mutation_id uuid NOT NULL,
  payload jsonb NOT NULL,
  edit_version integer NOT NULL DEFAULT 1 CHECK (edit_version >= 1),
  applied_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  applied_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  applied_follow_up_id uuid REFERENCES follow_ups(id) ON DELETE SET NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS boss_convention_submissions_request_mutation_unique ON boss_convention_submissions (request_id, client_mutation_id);
CREATE INDEX IF NOT EXISTS boss_convention_submissions_request_created_idx ON boss_convention_submissions (request_id, created_at);

CREATE TABLE IF NOT EXISTS communication_template_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES boss_work_requests(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES communication_templates(id) ON DELETE RESTRICT,
  template_version text,
  content_fingerprint text NOT NULL,
  subject_snapshot text,
  body_snapshot text NOT NULL,
  body_format_snapshot text NOT NULL CHECK (body_format_snapshot IN ('plain_text','html')),
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','changes_requested')),
  note text,
  decided_by_boss_account_id uuid REFERENCES boss_accounts(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_template_reviews_template_version_idx ON communication_template_reviews (template_id, template_version);
