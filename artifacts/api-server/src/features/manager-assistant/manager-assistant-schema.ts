import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

export async function ensureManagerAssistantSchema(pool: Pool = defaultPool): Promise<boolean> {
  const marker = await pool.query(
    `SELECT
       to_regclass(current_schema() || '.manager_admin_questions') IS NOT NULL
       AND to_regclass(current_schema() || '.manager_admin_question_responses') IS NOT NULL
       AND to_regclass(current_schema() || '.operations_knowledge_entries') IS NOT NULL
       AS ready`,
  );
  if (marker.rows[0]?.ready === true) return false;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS manager_admin_questions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_mutation_id text NOT NULL UNIQUE,
      travel_leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE RESTRICT,
      booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
      trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
      manager_session_subject text NOT NULL,
      question text NOT NULL CHECK (nullif(trim(question), '') IS NOT NULL),
      urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
      status text NOT NULL DEFAULT 'needs_answer' CHECK (status IN ('needs_answer','answered','resolved')),
      escalation_reason text NOT NULL CHECK (nullif(trim(escalation_reason), '') IS NOT NULL),
      checked_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
      context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      answered_at timestamptz,
      resolved_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS manager_admin_questions_status_urgency_created_idx
      ON manager_admin_questions(status, urgency, created_at);
    CREATE INDEX IF NOT EXISTS manager_admin_questions_leg_idx
      ON manager_admin_questions(travel_leg_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS manager_admin_questions_booking_idx
      ON manager_admin_questions(booking_id) WHERE booking_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS manager_admin_question_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id uuid NOT NULL REFERENCES manager_admin_questions(id) ON DELETE CASCADE,
      actor_type text NOT NULL CHECK (actor_type IN ('admin','manager')),
      actor_id text NOT NULL,
      body text NOT NULL CHECK (nullif(trim(body), '') IS NOT NULL),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS manager_admin_question_responses_question_time_idx
      ON manager_admin_question_responses(question_id, created_at, id);

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
    CREATE INDEX IF NOT EXISTS operations_knowledge_entries_scope_active_effective_idx
      ON operations_knowledge_entries(scope, scope_record_id, active, effective_at DESC);
  `);
  return true;
}
