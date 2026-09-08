import { pool as defaultPool } from "@workspace/db";
import { ensureBossSchema } from "./boss-startup-migration";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:boss-schema')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:boss-schema'))";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type Pool = { connect(): Promise<Client> };
type EnsureSchema = (client: Client) => Promise<boolean>;

export async function ensureBossSchemaBeforeListen(options?: {
  pool?: Pool;
  ensureSchema?: EnsureSchema;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const ensureSchema = options?.ensureSchema ?? ensureBossSchema;
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query(advisoryTryLockSql);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error("BOSS_SCHEMA_LOCK_BUSY");
    return await ensureSchema(client);
  } finally {
    if (locked) await client.query(advisoryUnlockSql).catch(() => undefined);
    client.release();
  }
}