ALTER TABLE office_email_drafts
  ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'plain_text',
  ADD COLUMN IF NOT EXISTS design_project_id uuid,
  ADD COLUMN IF NOT EXISTS design_version_id uuid,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS business_time_zone text,
  ADD COLUMN IF NOT EXISTS gmail_draft_id text,
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS gmail_thread_id text,
  ADD COLUMN IF NOT EXISTS send_request_key text,
  ADD COLUMN IF NOT EXISTS schedule_request_key text,
  ADD COLUMN IF NOT EXISTS dispatch_lease_owner text,
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_code text,
  ADD COLUMN IF NOT EXISTS last_failure_message text;

ALTER TABLE office_email_drafts
  DROP CONSTRAINT IF EXISTS office_email_drafts_state_check,
  DROP CONSTRAINT IF EXISTS office_email_drafts_state_valid,
  DROP CONSTRAINT IF EXISTS office_email_drafts_body_format_check,
  DROP CONSTRAINT IF EXISTS office_email_drafts_body_format_valid;

ALTER TABLE office_email_drafts
  ADD CONSTRAINT office_email_drafts_state_valid
    CHECK (state IN ('draft','submitted','needs_changes','gmail_draft','scheduled','sending','sent','failed','cancelled')),
  ADD CONSTRAINT office_email_drafts_body_format_valid
    CHECK (body_format IN ('plain_text','html'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'office_email_drafts_design_project_fk'
      AND conrelid = 'office_email_drafts'::regclass
  ) THEN
    ALTER TABLE office_email_drafts
      ADD CONSTRAINT office_email_drafts_design_project_fk
      FOREIGN KEY (design_project_id) REFERENCES design_projects(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'office_email_drafts_design_version_fk'
      AND conrelid = 'office_email_drafts'::regclass
  ) THEN
    ALTER TABLE office_email_drafts
      ADD CONSTRAINT office_email_drafts_design_version_fk
      FOREIGN KEY (design_version_id) REFERENCES design_project_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS office_email_drafts_design_project_unique
  ON office_email_drafts (design_project_id)
  WHERE design_project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS office_email_drafts_send_request_unique
  ON office_email_drafts (send_request_key)
  WHERE send_request_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS office_email_drafts_schedule_request_unique
  ON office_email_drafts (schedule_request_key)
  WHERE schedule_request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS office_email_drafts_dispatch_idx
  ON office_email_drafts (
    state,
    scheduled_for,
    next_attempt_at,
    dispatch_lease_expires_at
  );
