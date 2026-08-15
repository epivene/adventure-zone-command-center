import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

const constraintName = "call_sessions_note_activity_id_activities_id_fk";
const advisoryLockSql =
  "SELECT pg_advisory_lock(hashtext('adventure-zone:activity-delete-schema'))";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:activity-delete-schema'))";

/**
 * Keep saved call sessions when their visible note/activity is deleted.
 *
 * The note link is optional, so PostgreSQL should clear call_sessions.note_activity_id
 * instead of blocking deletion of the activity. Older databases created this foreign
 * key with the default NO ACTION behavior; repair it idempotently at API startup.
 */
export async function ensureActivityDeleteSchema(
  pool: Pool = defaultPool,
): Promise<void> {
  const client = await pool.connect();
  let locked = false;

  try {
    await client.query(advisoryLockSql);
    locked = true;

    const result = await client.query<{ deleteAction: string }>(`
      SELECT confdeltype AS "deleteAction"
      FROM pg_constraint
      WHERE conrelid = to_regclass(current_schema() || '.call_sessions')
        AND conname = '${constraintName}'
      LIMIT 1
    `);

    const constraint = result.rows[0];
    if (!constraint || constraint.deleteAction === "n") return;

    await client.query(`
      ALTER TABLE call_sessions
        DROP CONSTRAINT ${constraintName},
        ADD CONSTRAINT ${constraintName}
          FOREIGN KEY (note_activity_id)
          REFERENCES activities(id)
          ON DELETE SET NULL;
    `);
  } finally {
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
