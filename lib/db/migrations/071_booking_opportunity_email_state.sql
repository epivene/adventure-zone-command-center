CREATE TABLE IF NOT EXISTS booking_opportunity_email_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES booking_opportunities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  event_year integer NOT NULL,
  purpose text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  gmail_draft_id text,
  gmail_message_id text,
  gmail_thread_id text,
  recipient_email text NOT NULL,
  recipient_name text,
  subject text NOT NULL,
  body text NOT NULL,
  scheduled_for timestamptz,
  sent_at timestamptz,
  last_failure_code text,
  last_failure_message text,
  send_request_key text,
  schedule_request_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_opportunity_email_state_event_year_valid CHECK (event_year BETWEEN 2000 AND 2200),
  CONSTRAINT booking_opportunity_email_state_purpose_valid CHECK (purpose IN ('new_outreach','follow_up','reply')),
  CONSTRAINT booking_opportunity_email_state_state_valid CHECK (state IN ('draft','scheduled','sent','failed','cancelled')),
  CONSTRAINT booking_opportunity_email_state_recipient_valid CHECK (length(trim(recipient_email)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_opportunity_email_state_current_unique
  ON booking_opportunity_email_state(opportunity_id)
  WHERE state IN ('draft','scheduled','failed');

CREATE UNIQUE INDEX IF NOT EXISTS booking_opportunity_email_state_send_request_unique
  ON booking_opportunity_email_state(send_request_key)
  WHERE send_request_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_opportunity_email_state_schedule_request_unique
  ON booking_opportunity_email_state(schedule_request_key)
  WHERE schedule_request_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS booking_opportunity_email_state_ready_idx
  ON booking_opportunity_email_state(state, updated_at);

CREATE INDEX IF NOT EXISTS booking_opportunity_email_state_gmail_thread_idx
  ON booking_opportunity_email_state(gmail_thread_id);
