import { pool as defaultPool } from "@workspace/db";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:organizer-feedback-schema')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:organizer-feedback-schema'))";

const ensureSchemaSql = `
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
CREATE INDEX IF NOT EXISTS event_organizer_feedback_requests_booking_idx
  ON event_organizer_feedback_requests(booking_id);
CREATE INDEX IF NOT EXISTS event_organizer_feedback_requests_leg_idx
  ON event_organizer_feedback_requests(leg_id);

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

-- Repair databases that may have received an earlier partial version of the feature.
ALTER TABLE event_organizer_feedback ADD COLUMN IF NOT EXISTS admin_notes text;
ALTER TABLE event_organizer_feedback ADD COLUMN IF NOT EXISTS manager_acknowledged_at timestamptz;
ALTER TABLE event_organizer_feedback ADD COLUMN IF NOT EXISTS manager_response text;
ALTER TABLE event_organizer_feedback ADD COLUMN IF NOT EXISTS manager_responded_at timestamptz;
ALTER TABLE event_organizer_feedback ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE event_organizer_feedback ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS event_organizer_feedback_booking_idx
  ON event_organizer_feedback(booking_id);
CREATE INDEX IF NOT EXISTS event_organizer_feedback_leg_idx
  ON event_organizer_feedback(leg_id);
`;

type StartupClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type StartupPool = {
  connect(): Promise<StartupClient>;
};

export async function ensureOrganizerFeedbackSchemaBeforeListen(options?: {
  pool?: StartupPool;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as StartupPool);
  const client = await pool.connect();
  let locked = false;

  try {
    const result = await client.query(advisoryTryLockSql);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error("ORGANIZER_FEEDBACK_SCHEMA_LOCK_BUSY");
    await client.query(ensureSchemaSql);
    return true;
  } finally {
    if (locked) await client.query(advisoryUnlockSql).catch(() => undefined);
    client.release();
  }
}
