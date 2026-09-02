import { pool as defaultPool } from "@workspace/db";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Client = { query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>; release(): void };
type Pool = { connect(): Promise<Client> };
const lock = "SELECT pg_try_advisory_lock(hashtext('adventure-zone:inbound-calling-schema')) AS locked";
const unlock = "SELECT pg_advisory_unlock(hashtext('adventure-zone:inbound-calling-schema'))";
export async function ensureInboundCallingSchemaBeforeListen(options?: { pool?: Pool }): Promise<boolean> {
 const client = await (options?.pool ?? defaultPool as unknown as Pool).connect(); let locked = false;
 try { locked = (await client.query(lock)).rows[0]?.locked === true; if (!locked) throw new Error("INBOUND_CALLING_SCHEMA_LOCK_BUSY");
   await client.query("BEGIN");
   const migrationPath = resolve(
     process.cwd(),
     "../../lib/db/migrations/20260902_twilio_incoming_computer_calling.sql",
   );
   await client.query(
     readFileSync(migrationPath, "utf8").replace(/^BEGIN;|COMMIT;$/gm, ""),
   );
   await client.query("COMMIT"); return true;
 } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
 finally { if (locked) await client.query(unlock).catch(() => undefined); client.release(); }
}