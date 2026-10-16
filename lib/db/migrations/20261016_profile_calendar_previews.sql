CREATE TABLE IF NOT EXISTS profile_calendar_previews (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  actor text NOT NULL,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz NOT NULL,
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_calendar_previews_booking_idx ON profile_calendar_previews(booking_id, created_at);
