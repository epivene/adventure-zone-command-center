import { assertNoUnresolvedHoldDispatch } from "./outreach-dispatch";
import { rowsOf } from "./outreach-sources";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import {
  activeAllocationTransactions,
  allocationEnabled,
  withAllocationTransaction,
  invalidateAllocationIn,
  OutreachAllocation,
  type AllocationDatabase,
  type PreparedAllocation,
} from "./outreach-allocation";
import { createProductionOutreachAllocation } from "./production-outreach-allocation";
import {
  bookingDemandFacts,
  fingerprint,
  loadAllocationFacts,
  targetForBooking,
  type AllocationFacts,
} from "./outreach-capacity-evidence";
import { isBookedForSchedule } from "../calendar/schedule-booking-state";
import { OutreachError } from "./outreach-repository";

export type AllocationTransaction = Parameters<
  Parameters<AllocationDatabase["transaction"]>[0]
>[0];
export type CommitmentPlan = {
  // Internal pure projection, never supplied by HTTP. No callback is replayed.
  project?: (facts: AllocationFacts) => AllocationFacts;
  bookingIds?: string[];
  actor?: string;
  source: string;
};
const changed = (a: unknown, b: unknown) => fingerprint(a) !== fingerprint(b);
function bookingEvidence(f: AllocationFacts, id: string) {
  const b = f.bookings.find((b) => b.id === id);
  return b
    ? {
        ...bookingDemandFacts(f, b),
        status: b.status,
        probability: b.probability,
        demand: f.demands.find((d) => d.booking_id === id),
      }
    : null;
}
export async function finishCapacityWriteIn(tx: AllocationDatabase) {
  await invalidateAllocationIn(tx);
  await tx.execute(
    sql`update outreach_write_receipts set validated=true where transaction_id=txid_current()`,
  );
}

/** One execution of the existing transaction callback; all provider work precedes the mutex. */
export async function commitmentTransaction<T>(
  db: Pick<NodePgDatabase<any>, "transaction">,
  work: (tx: AllocationTransaction) => Promise<T>,
  plan: CommitmentPlan = { source: "booking-capacity-writer" },
  allocation = createProductionOutreachAllocation(db as AllocationDatabase),
): Promise<T> {
  if (!allocationEnabled()) return db.transaction(work);
  if (activeAllocationTransactions.has(db))
    throw new OutreachError(
      409,
      "Nested capacity changes require a single encompassing reviewed mutation plan.",
    );
  if ((plan.bookingIds?.length ?? 0) > 1)
    throw new OutreachError(
      409,
      "Review and commit one booking at a time; batch commitment plans are not supported.",
    );
  const before = await loadAllocationFacts(db as AllocationDatabase);
  const projected = plan.project
    ? plan.project(structuredClone(before))
    : structuredClone(before);
  const prepared = new Map<string, PreparedAllocation>();
  const ids = plan.bookingIds ?? [];
  for (const id of ids) {
    const own = before.holds.find(
      (h) =>
        h.booking_id === id &&
        h.state === "active" &&
        new Date(h.expires_at) > allocation.clock(),
    );
    if (own && !plan.project) {
      const target = targetForBooking(before, id).target;
      if (target?.demandFingerprint === own.demand_fingerprint) {
        for (const resource_id of own.resource_ids)
          if (
            !projected.assignments.some(
              (r) => r.booking_id === id && r.resource_id === resource_id,
            )
          )
            projected.assignments.push({ booking_id: id, resource_id });
        projected.assignments.sort(
          (a, b) =>
            a.booking_id.localeCompare(b.booking_id) ||
            a.resource_id.localeCompare(b.resource_id),
        );
        const demand = projected.demands.find((d) => d.booking_id === id)!;
        demand.facts_fingerprint = fingerprint(
          bookingDemandFacts(
            projected,
            projected.bookings.find((b) => b.id === id)!,
          ),
        );
      }
    }
    prepared.set(
      id,
      await allocation.prepareState(projected, id, { ownHoldId: own?.id }),
    );
  }
  return withAllocationTransaction(
    db as AllocationDatabase,
    async (tx) => {
      const current = await loadAllocationFacts(tx);
      if (changed(current, before))
        throw new OutreachError(
          409,
          "Allocation facts changed during verification; retry the booking change.",
        );
      const value = await work(tx as unknown as AllocationTransaction);
      let after = await loadAllocationFacts(tx);
      // Materialize precisely the already-held resource IDs when a status-only
      // commitment converts that hold. This does not change its quantities/revision.
      for (const [id, evidence] of prepared) {
        if (!evidence.ownHoldId || plan.project) continue;
        const b = after.bookings.find((b) => b.id === id),
          old = before.bookings.find((b) => b.id === id);
        if (!b || !old || isBookedForSchedule(old) || !isBookedForSchedule(b))
          continue;
        const hold = before.holds.find((h) => h.id === evidence.ownHoldId)!;
        for (const resourceId of hold.resource_ids)
          await tx.execute(
            sql`insert into booking_resource_assignments(booking_id,resource_id) select ${id}::uuid,${resourceId}::uuid where not exists(select 1 from booking_resource_assignments where booking_id=${id}::uuid and resource_id=${resourceId}::uuid)`,
          );
        const demand = projected.demands.find((d) => d.booking_id === id)!;
        await tx.execute(
          sql`update outreach_booking_demand set facts_fingerprint=${demand.facts_fingerprint} where booking_id=${id}::uuid`,
        );
      }
      after = await loadAllocationFacts(tx);
      const changedIds = [
        ...new Set([...before.bookings, ...after.bookings].map((b) => b.id)),
      ].filter((id) =>
        changed(bookingEvidence(before, id), bookingEvidence(after, id)),
      );
      const commitments = changedIds.filter((id) => {
        const b = after.bookings.find((b) => b.id === id);
        return b && isBookedForSchedule(b);
      });
      // A generic status callback may change one target's status/probability only.
      // Preserve all other status semantics in the global baseline proof. A batch
      // of commitments must use a separate explicitly supported batch workflow.
      const expected = structuredClone(projected);
      if (!plan.project) {
        if (commitments.length && changedIds.length > 1)
          throw new OutreachError(
            409,
            "Batch commitments require an explicit reviewed allocation plan.",
          );
        for (const id of changedIds) {
          const b = after.bookings.find((b) => b.id === id),
            e = expected.bookings.find((b) => b.id === id);
          if (e && b) {
            e.status = b.status;
            e.probability = b.probability;
            e.name = b.name;
          }
        }
      }
      if (commitments.length && changed(after, expected))
        throw new OutreachError(
          409,
          "This capacity change needs fresh exact demand. Use the reviewed commitment-change action with dates, leg, quantities and physical resources.",
        );
      for (const id of commitments) {
        const evidence = prepared.get(id);
        if (!evidence)
          throw new OutreachError(
            409,
            "Record and verify exact booking demand before making this commitment.",
          );
        // Explicit proof above established the complete expected resulting state.
        // Only a single target's status differs from baseline-provider evidence;
        // target geometry/demand and every other route stop are unchanged.
        const verified = {
          ...evidence,
          factsFingerprint: fingerprint(expected),
        };
        const result = await allocation.evaluateCommitmentIn(tx, verified);
        if (result.capacity.status !== "fits")
          throw new OutreachError(409, result.capacity.reasons.join(" "));
        if (evidence.ownHoldId) {
          const hold = after.holds.find((h) => h.id === evidence.ownHoldId)!;
          await assertNoUnresolvedHoldDispatch(tx, hold.id);
          await tx.execute(
            sql`update outreach_holds set state='converted',ended_at=${allocation.clock()},revision=revision+1 where id=${hold.id}::uuid and state='active'`,
          );
          await tx.execute(
            sql`insert into outreach_audit(actor,action,entity_id,detail) values (${plan.actor ?? "system"},'convert_hold',${hold.id}::uuid,${JSON.stringify({ bookingId: id, source: plan.source, holdRevision: hold.revision })}::jsonb)`,
          );
        }
      }
      // Prospective edits/cancellation are safe to persist but never retain a hold
      // bound to different demand or a no-longer-proposed booking.
      for (const h of after.holds.filter((h) => h.state === "active")) {
        if (
          !changedIds.includes(h.booking_id) ||
          commitments.includes(h.booking_id)
        )
          continue;
        const target = targetForBooking(after, h.booking_id).target;
        if (!target || target.demandFingerprint !== h.demand_fingerprint)
          throw new OutreachError(
            409,
            "Release the existing hold before changing its booking demand.",
          );
      }
      const dirty = rowsOf<{ dirty: boolean }>(
        await tx.execute(
          sql`select dirty from outreach_write_receipts where transaction_id=txid_current()`,
        ),
      )[0]?.dirty;
      if (changed(before, after) || dirty) await finishCapacityWriteIn(tx);
      else
        await tx.execute(
          sql`update outreach_write_receipts set validated=true where transaction_id=txid_current()`,
        );
      return value;
    },
    { mode: "commitment", source: plan.source },
  );
}

export type ReconciliationSource =
  | "operational-calendar-import"
  | "operational-calendar-link"
  | "assistant-history-import"
  | "act-history-import"
  | "resource-inventory"
  | "package-inventory"
  | "calendar-sync"
  | "canonical-merge"
  | "committed-demand-review";
/** Internal factual import boundary. No request boolean can choose this mode. */
export async function reconcileCapacityFacts<T>(
  db: Pick<NodePgDatabase<any>, "transaction">,
  source: ReconciliationSource,
  work: (tx: AllocationTransaction) => Promise<T>,
  detail: {
    actor?: string;
    reason?: string;
    provenance?: {
      integration: string;
      route: string;
      requestId: string | null;
      receivedAt: string;
      payloadHash: string;
      submittedFacts: unknown;
    };
    isolationLevel?:
      | "read uncommitted"
      | "read committed"
      | "repeatable read"
      | "serializable";
  } = {},
) {
  if (!allocationEnabled())
    return db.transaction(
      work,
      detail.isolationLevel
        ? { isolationLevel: detail.isolationLevel }
        : undefined,
    );
  const enclosing = activeAllocationTransactions.get(db);
  if (enclosing) {
    if (enclosing !== "reconciliation")
      throw new OutreachError(
        409,
        "Factual reconciliation cannot bypass a prospective commitment transaction.",
      );
    return work(db as unknown as AllocationTransaction);
  }
  return withAllocationTransaction(
    db as AllocationDatabase,
    async (tx) => {
      const before = await loadAllocationFacts(tx);
      const result = await work(tx as unknown as AllocationTransaction);
      const after = await loadAllocationFacts(tx);
      if (changed(before, after)) {
        const ids = [
          ...new Set([...before.bookings, ...after.bookings].map((b) => b.id)),
        ].filter((id) =>
          changed(bookingEvidence(before, id), bookingEvidence(after, id)),
        );
        await tx.execute(
          sql`insert into outreach_reconciliation_facts(source,actor,reason,booking_ids,facts_fingerprint,detail) values (${source},${detail.actor ?? "system"},${detail.reason ?? (source === "assistant-history-import" ? "Unverified assistant-supplied commitment claim; independent owner source review is required." : "Authoritative source facts imported; fresh allocation review required.")},${JSON.stringify(ids)}::jsonb,${fingerprint(after)},${JSON.stringify({ before: fingerprint(before), after: fingerprint(after), capacityReviewRequired: true, provenance: detail.provenance ?? { integration: source, receivedAt: new Date().toISOString() }, changes: ids.map((id) => ({ bookingId: id, before: bookingEvidence(before, id), after: bookingEvidence(after, id) })) })}::jsonb)`,
        );
      }
      await finishCapacityWriteIn(tx);
      return result;
    },
    { mode: "reconciliation", source },
    detail.isolationLevel
      ? { isolationLevel: detail.isolationLevel }
      : undefined,
  );
}
