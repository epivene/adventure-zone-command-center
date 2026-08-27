ALTER TABLE booking_opportunity_email_state
  ADD COLUMN IF NOT EXISTS dispatch_lease_owner text,
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_attempt_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS booking_opportunity_email_state_dispatch_idx
  ON booking_opportunity_email_state (state, scheduled_for, dispatch_lease_expires_at);
