import { pool as defaultPool } from "@workspace/db";
const ensureSchemaSql = `
DROP TRIGGER IF EXISTS follow_ups_location_org_match ON follow_ups;
CREATE TRIGGER follow_ups_location_org_match
  BEFORE INSERT OR UPDATE OF organization_id, organization_location_id ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION check_organization_location_org_match();
`;

// Catalog-only check: an installed trigger must not be dropped on every boot.
export const followUpDismissalReadySql = `SELECT EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgrelid = to_regclass(current_schema() || '.follow_ups')
    AND t.tgname = 'follow_ups_location_org_match'
    AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
    AND t.tgtype = 23 -- ROW + BEFORE + INSERT + UPDATE
    AND t.tgfoid = to_regprocedure(current_schema() || '.check_organization_location_org_match()')
    AND t.tgnargs = 0 AND t.tgqual IS NULL
    AND cardinality(t.tgattr::smallint[]) = 2
    AND (SELECT count(*) = 2 FROM pg_attribute a
         WHERE a.attrelid = t.tgrelid AND NOT a.attisdropped
           AND a.attname IN ('organization_id', 'organization_location_id')
           AND a.attnum = ANY(t.tgattr::smallint[]))
) AS ready`;

async function isFollowUpDismissalSchemaReady(
  client: Client,
): Promise<boolean> {
  return (
    (await client.query(followUpDismissalReadySql)).rows[0]?.ready === true
  );
}

const advisoryTryLockSql =
  "SELECT pg_try_advisory_xact_lock(hashtext('adventure-zone:follow-up-dismissal-persistence')) AS locked";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
};
type Pool = { connect(): Promise<Client> };

export async function ensureFollowUpDismissalPersistenceBeforeListen(options?: {
  pool?: Pool;
  lockWaitMs?: number;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const client = await pool.connect();
  let inTransaction = false;
  let destroy = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    // Server-side limits cancel blocked work before the pool's 60s read timeout.
    // SET LOCAL never leaks a timeout setting into unrelated pooled requests.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    if (await isFollowUpDismissalSchemaReady(client)) {
      await client.query("COMMIT");
      inTransaction = false;
      return true;
    }
    const deadline =
      Date.now() + Math.max(0, Math.min(options?.lockWaitMs ?? 10_000, 10_000));
    for (;;) {
      const result = await client.query(advisoryTryLockSql);
      if (result.rows[0]?.locked === true) break;
      if (Date.now() >= deadline)
        throw new Error("FOLLOW_UP_DISMISSAL_SCHEMA_LOCK_BUSY");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
      );
    }
    // A competing deploy may have finished while we waited for the lock.
    if (!(await isFollowUpDismissalSchemaReady(client))) {
      await client.query(ensureSchemaSql);
    }
    if (!(await isFollowUpDismissalSchemaReady(client))) {
      throw new Error("FOLLOW_UP_DISMISSAL_SCHEMA_INCOMPLETE");
    }
    await client.query("COMMIT");
    inTransaction = false;
    return true;
  } catch (error) {
    // A client-side timeout can leave work running on this connection. Never
    // return a failed migration connection or its locks to the request pool.
    destroy = true;
    const connectionUnusable =
      error instanceof Error &&
      /query read timeout|connection terminated|connection closed/i.test(
        error.message,
      );
    if (inTransaction && !connectionUnusable)
      await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(destroy);
  }
}
