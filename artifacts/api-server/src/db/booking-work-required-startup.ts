import { pool as defaultPool } from "@workspace/db";

import { ensureBookingWorkSchema } from "./booking-work-schema";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:booking-work-schema')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:booking-work-schema'))";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type Pool = { connect(): Promise<Client> };
type EnsureSchema = (client: Client) => Promise<void>;

export async function ensureBookingWorkSchemaBeforeListen(options?: {
  pool?: Pool;
  ensureSchema?: EnsureSchema;
}): Promise<void> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const ensureSchema = options?.ensureSchema ?? ensureBookingWorkSchema;
  const client = await pool.connect();
  let locked = false;

  try {
    const result = await client.query(advisoryTryLockSql);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error("BOOKING_WORK_SCHEMA_LOCK_BUSY");
    return await ensureSchema(client);
  } finally {
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
