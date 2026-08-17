import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

const advisoryLockSql =
  "SELECT pg_advisory_lock(hashtext('adventure-zone:profile-archive-schema'))";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:profile-archive-schema'))";

/** Ensure Render/API startups that bypass a standalone migration runner still have profile archive state. */
export async function ensureProfileArchiveSchema(
  pool: Pool = defaultPool,
): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query(advisoryLockSql);
    locked = true;
    await client.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      CREATE INDEX IF NOT EXISTS organizations_archived_at_idx
        ON organizations (archived_at);
    `);
  } finally {
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
