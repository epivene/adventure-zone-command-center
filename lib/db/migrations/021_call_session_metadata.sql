BEGIN;

ALTER TYPE call_disposition ADD VALUE IF NOT EXISTS 'spoke_with_contact';
ALTER TYPE call_disposition ADD VALUE IF NOT EXISTS 'wrong_number';
ALTER TYPE call_disposition ADD VALUE IF NOT EXISTS 'do_not_call';

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS phone_id uuid REFERENCES contact_phones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outgoing',
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'standard_call',
  ADD COLUMN IF NOT EXISTS phone_number_snapshot text,
  ADD COLUMN IF NOT EXISTS phone_extension_snapshot text,
  ADD COLUMN IF NOT EXISTS script_kind text;

ALTER TABLE call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_direction_valid,
  DROP CONSTRAINT IF EXISTS call_sessions_method_valid,
  DROP CONSTRAINT IF EXISTS call_sessions_script_kind_valid;

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_direction_valid CHECK (direction in ('incoming', 'outgoing')),
  ADD CONSTRAINT call_sessions_method_valid CHECK (method in ('standard_call', 'office_call', 'individual_voicemail', 'mobile_log')),
  ADD CONSTRAINT call_sessions_script_kind_valid CHECK (script_kind in ('first_outreach', 'follow_up', 'contract_follow_up', 'incoming_inquiry') or script_kind is null);

COMMIT;
