import { pool as defaultPool } from "@workspace/db";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:event-review-dismissal-schema')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:event-review-dismissal-schema'))";

const ensureSchemaSql = `
CREATE TABLE IF NOT EXISTS event_manager_review_dismissals (
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE CASCADE,
  reason text NOT NULL,
  dismissed_by text NOT NULL DEFAULT 'owner',
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, leg_id),
  CONSTRAINT event_manager_review_dismissals_reason_nonblank
    CHECK (nullif(trim(reason), '') IS NOT NULL),
  CONSTRAINT event_manager_review_dismissals_actor_nonblank
    CHECK (nullif(trim(dismissed_by), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS event_manager_review_dismissals_leg_idx
  ON event_manager_review_dismissals(leg_id, dismissed_at DESC);
`;

type StartupClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type StartupPool = {
  connect(): Promise<StartupClient>;
};

export async function ensureEventReviewDismissalSchemaBeforeListen(options?: {
  pool?: StartupPool;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as StartupPool);
  const client = await pool.connect();
  let locked = false;

  try {
    const result = await client.query(advisoryTryLockSql);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error("EVENT_REVIEW_DISMISSAL_SCHEMA_LOCK_BUSY");
    await client.query(ensureSchemaSql);
    return true;
  } finally {
    if (locked) await client.query(advisoryUnlockSql).catch(() => undefined);
    client.release();
  }
}
