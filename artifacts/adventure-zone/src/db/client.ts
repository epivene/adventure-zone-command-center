// Frontend stub — the database is never used in the browser at runtime.
// Repository files copied from the server import `db` for its TYPE only,
// so we expose the real Drizzle type with a null runtime value.
import type { db as realDb, pool as realPool } from "@workspace/db";

export const db = null as unknown as typeof realDb;
export const pool = null as unknown as typeof realPool;
