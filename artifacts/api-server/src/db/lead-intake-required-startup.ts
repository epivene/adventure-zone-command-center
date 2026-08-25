import { pool as defaultPool } from "@workspace/db";
import { ensureLeadIntakeSchema } from "./lead-intake-startup-migration";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};
type Pool = { connect(): Promise<Client> };

export async function ensureLeadIntakeSchemaBeforeListen(options?: {
  pool?: Pool;
  ensureSchema?: (client: Client) => Promise<boolean>;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('adventure-zone:lead-intake-schema'))");
    locked = true;
    return await (options?.ensureSchema ?? ensureLeadIntakeSchema)(client);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('adventure-zone:lead-intake-schema'))").catch(() => undefined);
    client.release();
  }
}
