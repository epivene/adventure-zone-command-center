CREATE TABLE IF NOT EXISTS guided_call_needs_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  follow_up_id uuid REFERENCES follow_ups(id) ON DELETE SET NULL,
  call_session_id uuid REFERENCES call_sessions(id) ON DELETE SET NULL,
  user_note text,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT guided_call_needs_answers_question_nonblank CHECK (btrim(question) <> ''),
  CONSTRAINT guided_call_needs_answers_status_valid CHECK (status IN ('open', 'resolved')),
  CONSTRAINT guided_call_needs_answers_resolution_consistent CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolution IS NOT NULL AND btrim(resolution) <> '')
  )
);

CREATE INDEX IF NOT EXISTS guided_call_needs_answers_status_created_idx
  ON guided_call_needs_answers(status, created_at DESC);
CREATE INDEX IF NOT EXISTS guided_call_needs_answers_booking_idx
  ON guided_call_needs_answers(booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS guided_call_needs_answers_contact_idx
  ON guided_call_needs_answers(contact_id)
  WHERE contact_id IS NOT NULL;
