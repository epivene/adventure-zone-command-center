CREATE TABLE IF NOT EXISTS manager_admin_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_mutation_id text NOT NULL,
  travel_leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
  manager_session_subject text NOT NULL,
  question text NOT NULL CHECK (nullif(trim(question), '') IS NOT NULL),
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  status text NOT NULL DEFAULT 'needs_answer' CHECK (status IN ('needs_answer','answered','resolved')),
  escalation_reason text NOT NULL CHECK (nullif(trim(escalation_reason), '') IS NOT NULL),
  checked_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS manager_admin_questions_client_mutation_unique
  ON manager_admin_questions(client_mutation_id);
CREATE INDEX IF NOT EXISTS manager_admin_questions_status_urgency_created_idx
  ON manager_admin_questions(status, urgency, created_at);
CREATE INDEX IF NOT EXISTS manager_admin_questions_leg_idx
  ON manager_admin_questions(travel_leg_id);
CREATE INDEX IF NOT EXISTS manager_admin_questions_booking_idx
  ON manager_admin_questions(booking_id);

CREATE TABLE IF NOT EXISTS manager_admin_question_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES manager_admin_questions(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('admin','manager')),
  actor_id text NOT NULL,
  body text NOT NULL CHECK (nullif(trim(body), '') IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manager_admin_question_responses_question_created_idx
  ON manager_admin_question_responses(question_id, created_at);

CREATE TABLE IF NOT EXISTS operations_knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (nullif(trim(title), '') IS NOT NULL),
  body text NOT NULL CHECK (nullif(trim(body), '') IS NOT NULL),
  scope text NOT NULL CHECK (scope IN ('global','package','resource','site','leg')),
  scope_record_id text,
  source_admin_question_id uuid REFERENCES manager_admin_questions(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  effective_at timestamptz NOT NULL DEFAULT now(),
  review_after timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operations_knowledge_entries_active_effective_idx
  ON operations_knowledge_entries(active, effective_at);
CREATE INDEX IF NOT EXISTS operations_knowledge_entries_scope_idx
  ON operations_knowledge_entries(scope, scope_record_id);
