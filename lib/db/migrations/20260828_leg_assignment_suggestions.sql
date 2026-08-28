CREATE TABLE IF NOT EXISTS booking_leg_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  assigned_leg_id uuid REFERENCES travel_legs(id) ON DELETE SET NULL,
  suggested_leg_id uuid REFERENCES travel_legs(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('prior_year','route_score','manual','needs_review')),
  explanation text NOT NULL CHECK (nullif(trim(explanation), '') IS NOT NULL),
  warning text CHECK (warning IS NULL OR warning IN ('long_travel','major_travel_concern')),
  previous_stop_drive_minutes integer CHECK (previous_stop_drive_minutes IS NULL OR previous_stop_drive_minutes >= 0),
  next_stop_drive_minutes integer CHECK (next_stop_drive_minutes IS NULL OR next_stop_drive_minutes >= 0),
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_leg_assignments_booking_unique
  ON booking_leg_assignments(booking_id);
CREATE INDEX IF NOT EXISTS booking_leg_assignments_suggested_leg_idx
  ON booking_leg_assignments(suggested_leg_id);

CREATE TABLE IF NOT EXISTS booking_operational_windows (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app','google_calendar','manual')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS booking_operational_windows_starts_ends_idx
  ON booking_operational_windows(starts_at, ends_at);

INSERT INTO booking_operational_windows (booking_id, starts_at, ends_at, source)
SELECT id, starts_at, ends_at, 'app'
FROM bookings
WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL
ON CONFLICT (booking_id) DO NOTHING;
