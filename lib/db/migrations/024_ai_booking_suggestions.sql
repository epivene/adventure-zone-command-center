-- Persist AI booking suggestions so they survive server restarts/redeploys.
CREATE TABLE IF NOT EXISTS ai_booking_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggested_date text,
  suggested_date_end text,
  client_name text,
  trip_description text NOT NULL,
  location text,
  confidence text DEFAULT 'low' NOT NULL,
  source_snippet text NOT NULL,
  act_record_id text,
  status text DEFAULT 'pending' NOT NULL,
  booking_id uuid REFERENCES bookings(id),
  dedupe_key text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT ai_booking_suggestions_confidence_valid
    CHECK (confidence IN ('high', 'medium', 'low')),
  CONSTRAINT ai_booking_suggestions_status_valid
    CHECK (status IN ('pending', 'accepted', 'dismissed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_booking_suggestions_dedupe_key_unique
  ON ai_booking_suggestions (dedupe_key);
