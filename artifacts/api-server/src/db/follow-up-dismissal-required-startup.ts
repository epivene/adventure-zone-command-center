import { pool as defaultPool } from "@workspace/db";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:follow-up-dismissal-persistence')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:follow-up-dismissal-persistence'))";

const ensureSchemaSql = `
DROP TRIGGER IF EXISTS follow_ups_location_org_match ON follow_ups;
CREATE TRIGGER follow_ups_location_org_match
  BEFORE INSERT OR UPDATE OF organization_id, organization_location_id ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION check_organization_location_org_match();
`;

type StartupClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type StartupPool = {
  connect(): Promise<StartupClient>;
};

export async function ensureFollowUpDismissalPersistenceBeforeListen(options?: {
  pool?: StartupPool;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as StartupPool);
  const client = await pool.connect();
  let locked = false;

  try {
    const result = await client.query(advisoryTryLockSql);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error("FOLLOW_UP_DISMISSAL_SCHEMA_LOCK_BUSY");
    await client.query(ensureSchemaSql);
    return true;
  } finally {
    if (locked) await client.query(advisoryUnlockSql).catch(() => undefined);
    client.release();
  }
}
