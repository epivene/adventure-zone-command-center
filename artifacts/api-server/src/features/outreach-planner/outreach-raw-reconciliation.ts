import { drizzle } from "drizzle-orm/node-postgres";
import { allocationEnabled } from "./outreach-allocation";
import { fingerprint, loadAllocationFacts } from "./outreach-capacity-evidence";
import { OutreachError } from "./outreach-repository";
export type RawCapacityClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};
export async function beginRawCapacityReconciliation(
  client: RawCapacityClient,
  source: string,
) {
  if (!allocationEnabled()) return;
  const lock = await client.query(
    "select id from outreach_allocation_mutex where id=1 for update",
  );
  if (lock.rows.length !== 1)
    throw new OutreachError(
      409,
      "Allocation mutex missing; repair the migration.",
    );
  await client.query("select pg_advisory_xact_lock(908092026)");
  await client.query(
    "insert into outreach_write_receipts(transaction_id,mode,source) values (txid_current(),'reconciliation',$1)",
    [source],
  );
}
export async function finishRawCapacityReconciliation(
  client: RawCapacityClient,
  source: string,
) {
  if (!allocationEnabled()) return;
  const facts = await loadAllocationFacts(drizzle(client as never));
  await client.query(
    "insert into outreach_reconciliation_facts(source,actor,reason,booking_ids,facts_fingerprint,detail) values ($1,'system','Authoritative source facts changed; fresh allocation verification required.','[]'::jsonb,$2,'{\"capacityReviewRequired\":true}'::jsonb)",
    [source, fingerprint(facts)],
  );
  await client.query(
    "update outreach_allocation_mutex set generation=generation+1 where id=1",
  );
  await client.query(
    "update outreach_candidates set checked_at=null,source_snapshot=null where checked_at is not null or source_snapshot is not null",
  );
  await client.query(
    "update outreach_write_receipts set validated=true where transaction_id=txid_current()",
  );
}
export async function rawCalendarFactQuery<
  T extends { rows: Record<string, unknown>[] },
>(
  pool: {
    query(text: string, values?: unknown[]): Promise<T>;
    connect?: () => Promise<RawCapacityClient & { release(): void }>;
  },
  text: string,
  values?: unknown[],
  source = "calendar-connection",
): Promise<T> {
  if (!allocationEnabled()) return pool.query(text, values);
  if (!pool.connect)
    throw new OutreachError(
      409,
      "Calendar reconciliation requires a transaction-capable database connection.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await beginRawCapacityReconciliation(client, source);
    const result = await client.query(text, values);
    await finishRawCapacityReconciliation(client, source);
    await client.query("COMMIT");
    return result as T;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
