BEGIN;

CREATE TABLE IF NOT EXISTS computer_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  phone_id uuid NOT NULL REFERENCES contact_phones(id),
  provider text NOT NULL,
  provider_call_sid text UNIQUE,
  direction text NOT NULL DEFAULT 'outbound',
  method text NOT NULL DEFAULT 'browser_voip',
  status text NOT NULL,
  caller_id_snapshot text NOT NULL,
  destination_number_snapshot text NOT NULL,
  intent_expires_at timestamptz NOT NULL,
  intent_consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  duration_seconds integer,
  error_code text,
  error_summary text,
  CONSTRAINT computer_call_sessions_provider_valid CHECK (provider = 'twilio'),
  CONSTRAINT computer_call_sessions_direction_valid CHECK (direction = 'outbound'),
  CONSTRAINT computer_call_sessions_method_valid CHECK (method = 'browser_voip'),
  CONSTRAINT computer_call_sessions_status_valid CHECK (status IN ('created', 'queued', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'canceled', 'failed', 'unknown')),
  CONSTRAINT computer_call_sessions_duration_seconds_nonnegative CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS computer_call_sessions_owner_created_at_idx
  ON computer_call_sessions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS computer_call_sessions_phone_id_idx
  ON computer_call_sessions(phone_id);
CREATE INDEX IF NOT EXISTS computer_call_sessions_provider_call_sid_idx
  ON computer_call_sessions(provider_call_sid);

ALTER TABLE call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_method_valid;

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_method_valid CHECK (method IN ('standard_call', 'office_call', 'individual_voicemail', 'mobile_log', 'browser_voip'));

COMMIT;
