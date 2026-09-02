BEGIN;
CREATE TABLE IF NOT EXISTS inbound_call_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL, provider_parent_call_sid text NOT NULL UNIQUE,
 provider_browser_call_sid text UNIQUE, provider text NOT NULL DEFAULT 'twilio', direction text NOT NULL DEFAULT 'inbound',
 method text NOT NULL DEFAULT 'browser_voip', ingress_number_snapshot text NOT NULL, caller_number_snapshot text,
 organization_id uuid REFERENCES organizations(id), contact_id uuid REFERENCES contacts(id), phone_id uuid REFERENCES contact_phones(id),
 status text NOT NULL DEFAULT 'ringing', browser_result text, voicemail_requested_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 ringing_at timestamptz, answered_at timestamptz, ended_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), error_code text, error_summary text,
 CONSTRAINT inbound_call_sessions_provider CHECK (provider='twilio'), CONSTRAINT inbound_call_sessions_direction CHECK (direction='inbound'),
 CONSTRAINT inbound_call_sessions_method CHECK (method='browser_voip'), CONSTRAINT inbound_call_sessions_status CHECK (status IN ('ringing','in-progress','completed','busy','no-answer','failed','canceled','unknown'))
);
CREATE TABLE IF NOT EXISTS incoming_call_availability_leases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL UNIQUE, client_identity text NOT NULL UNIQUE,
 lease_token_hash text NOT NULL, browser_session_id text NOT NULL, expires_at timestamptz NOT NULL,
 heartbeat_at timestamptz NOT NULL, active_inbound_session_id uuid REFERENCES inbound_call_sessions(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inbound_voicemails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inbound_session_id uuid NOT NULL UNIQUE REFERENCES inbound_call_sessions(id),
 recording_sid text UNIQUE, status text NOT NULL DEFAULT 'processing', duration_seconds integer, content_type text,
 retention_deadline timestamptz, handled_at timestamptz, handled_by text, organization_id uuid REFERENCES organizations(id),
 contact_id uuid REFERENCES contacts(id), phone_id uuid REFERENCES contact_phones(id), deletion_attempted_at timestamptz,
 deletion_lease_expires_at timestamptz, deletion_attempts integer NOT NULL DEFAULT 0, deletion_error text,
 call_session_id uuid UNIQUE REFERENCES call_sessions(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT inbound_voicemails_status CHECK (status IN ('processing','available','handled','deletion_pending','audio_deleted','failed'))
);
ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS inbound_technical_session_id uuid REFERENCES inbound_call_sessions(id);
CREATE UNIQUE INDEX IF NOT EXISTS call_sessions_inbound_technical_session_unique ON call_sessions(inbound_technical_session_id) WHERE inbound_technical_session_id IS NOT NULL;
COMMIT;