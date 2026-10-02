import { sql, type SQL } from "drizzle-orm";
/** Internal identifiers only; the evidence alias is reserved for reader integration. */
export function bookingDateProjectionSql(bookingAlias: string, windowAlias: string, evidenceAlias: string): SQL {
  for (const name of [bookingAlias, windowAlias, evidenceAlias]) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("Invalid internal SQL alias");
  }
  return sql.raw(`booking_resolved_dates(${bookingAlias}.id,${bookingAlias}.starts_at,${bookingAlias}.ends_at,${windowAlias}.starts_at,${windowAlias}.ends_at)`);
}
