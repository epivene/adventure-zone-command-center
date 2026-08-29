CREATE TABLE IF NOT EXISTS event_organizer_feedback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  leg_id uuid NOT NULL,
  event_name text NOT NULL,
  event_date_label text,
  manager_name text,
  recipient_name text,
  recipient_email text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_organizer_feedback_requests_booking_idx ON event_organizer_feedback_requests(booking_id);
CREATE INDEX IF NOT EXISTS event_organizer_feedback_requests_leg_idx ON event_organizer_feedback_requests(leg_id);

CREATE TABLE IF NOT EXISTS event_organizer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES event_organizer_feedback_requests(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL,
  leg_id uuid NOT NULL,
  event_name text NOT NULL,
  event_date_label text,
  overall_rating integer NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  professionalism_rating integer NOT NULL CHECK (professionalism_rating BETWEEN 1 AND 5),
  setup_rating integer NOT NULL CHECK (setup_rating BETWEEN 1 AND 5),
  communication_rating integer NOT NULL CHECK (communication_rating BETWEEN 1 AND 5),
  invite_back text NOT NULL CHECK (invite_back IN ('yes','maybe','no')),
  comments text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  admin_notes text,
  manager_acknowledged_at timestamptz,
  manager_response text,
  manager_responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_organizer_feedback_booking_idx ON event_organizer_feedback(booking_id);
CREATE INDEX IF NOT EXISTS event_organizer_feedback_leg_idx ON event_organizer_feedback(leg_id);
