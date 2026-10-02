import { assertNoUnresolvedHoldDispatch } from "./outreach-dispatch";
import { sql } from "drizzle-orm";
import type { db as runtimeDb } from "@workspace/db";
import { OutreachError, OutreachRepository } from "./outreach-repository";
import { isBookedForSchedule } from "../calendar/schedule-booking-state";
import { rowsOf, type QueryDatabase } from "./outreach-sources";
import type { CapacityDecision } from "./capacity-policy";
import {
  bookingDemandFacts,
  capacityDecision,
  excludeOwnHold,
  fingerprint,
  loadAllocationFacts,
  canonicalPackageQuantities,
  projectReservations,
  readExternalEvidence,
  reconcileCalendar,
  targetForBooking,
  verifyTravel,
  type AllocationFacts,
  type AllocationProviders,
  type AllocationTarget,
  type ExternalEvidence,
  type HoldFact,
  type DemandFact,
} from "./outreach-capacity-evidence";
import {
  exactDemandInput,
  holdExpiryInput,
  type AllocationCheckDTO,
  type AllocationCatalogDTO,
} from "./outreach-dto";

export type AllocationDatabase = typeof runtimeDb;
export type PreparedAllocation = {
  bookingId: string;
  candidateId?: string;
  ownHoldId?: string;
  factsFingerprint: string;
  target: AllocationTarget | null;
  external: ExternalEvidence | null;
  travelReasons: string[];
  reasons: string[];
};
export const allocationEnabled = () =>
  process.env.OUTREACH_PLANNER_ENABLED === "true";
export const capacityEnforcementEnabled = () =>
  allocationEnabled() || process.env.LEG_PLANNING_ENABLED === "true";
const review = (...reasons: string[]): CapacityDecision => ({
  status: "needs_review",
  reasons,
});

// Shared boundary, always before booking/resource row locks.
export const activeAllocationTransactions = new WeakMap<
  object,
  "allocation" | "commitment" | "reconciliation"
>();
export async function withAllocationTransaction<T>(
  db: AllocationDatabase,
  work: (tx: AllocationDatabase) => Promise<T>,
  participation: {
    mode: "allocation" | "commitment" | "reconciliation";
    source: string;
  } = { mode: "allocation", source: "outreach-allocation" },
  transactionConfig?: Parameters<AllocationDatabase["transaction"]>[1],
): Promise<T> {
  return db.transaction(async (tx) => {
    const locked = rowsOf(
      await tx.execute(
        sql`select id from outreach_allocation_mutex where id=1 for update`,
      ),
    );
    if (locked.length !== 1)
      throw new OutreachError(
        409,
        "Allocation mutex is missing; repair the allocation migration before retrying.",
      );
    // Candidate leadership and manual/history classifications cannot change while a hold is created.
    await tx.execute(sql`select pg_advisory_xact_lock(908092026)`);
    await tx.execute(
      sql`insert into outreach_write_receipts(transaction_id,mode,source) values (txid_current(),${participation.mode},${participation.source})`,
    );
    activeAllocationTransactions.set(tx, participation.mode);
    const planning = process.env.LEG_PLANNING_ENABLED === "true";
    const hooks = planning
      ? await import("../leg-planning/planning-writer-hooks")
      : null;
    const beforePlanning =
      hooks && participation.mode === "allocation"
        ? await hooks.planningSnapshotIn(tx)
        : null;
    let result: T;
    try {
      result = await work(tx as unknown as AllocationDatabase);
      if (hooks && beforePlanning)
        await hooks.checkPlanningWriteIn(
          tx,
          beforePlanning,
          await hooks.planningSnapshotIn(tx),
          "commitment",
        );
    } finally {
      activeAllocationTransactions.delete(tx);
    }
    if (participation.mode === "allocation")
      await tx.execute(
        sql`update outreach_write_receipts set validated=true where transaction_id=txid_current()`,
      );
    return result;
  }, transactionConfig);
}
export async function invalidateAllocationIn(tx: QueryDatabase) {
  await tx.execute(
    sql`update outreach_allocation_mutex set generation=generation+1 where id=1`,
  );
  await tx.execute(
    sql`update outreach_candidates set checked_at=null,source_snapshot=null where checked_at is not null or source_snapshot is not null`,
  );
}
async function audit(
  tx: QueryDatabase,
  actor: string,
  action: string,
  id: string,
  detail: unknown,
) {
  await tx.execute(
    sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},${action},${id}::uuid,${JSON.stringify(detail)}::jsonb)`,
  );
}
export async function expireHoldsIn(tx: QueryDatabase, now: Date) {
  const expired = rowsOf<HoldFact>(
    await tx.execute(
      sql`update outreach_holds set state='expired',ended_at=${now},revision=revision+1 where state='active' and expires_at<=${now} returning *`,
    ),
  );
  for (const h of expired)
    await audit(tx, "system", "expire_hold", h.id, {
      bookingId: h.booking_id,
      revision: h.revision,
    });
  if (expired.length) await invalidateAllocationIn(tx);
}
export class OutreachAllocation {
  constructor(
    readonly db: AllocationDatabase,
    readonly providers: AllocationProviders,
    readonly enabled = allocationEnabled,
    readonly clock = () => new Date(),
  ) {}
  gate() {
    if (!this.enabled())
      throw new OutreachError(404, "Outreach planner is disabled.");
  }
  async candidateBooking(tx: QueryDatabase, candidateId: string) {
    const [row] = rowsOf<{
      booking_id: string | null;
      opportunity_id: string;
      released_at: string | null;
      status: string;
      starts_on: string;
      ends_on: string;
      leg_id: string | null;
      quantities: Record<string, number>;
    }>(
      await tx.execute(
        sql`select o.booking_id,c.opportunity_id,c.released_at,w.status,w.starts_on,w.ends_on,w.leg_id,w.quantities from outreach_candidates c join booking_opportunities o on o.id=c.opportunity_id join outreach_openings w on w.id=c.opening_id where c.id=${candidateId}::uuid`,
      ),
    );
    if (!row) throw new OutreachError(404, "Candidate not found.");
    return row;
  }
  async prepare(
    bookingId: string,
    options: { candidateId?: string; ownHoldId?: string } = {},
  ): Promise<PreparedAllocation> {
    this.gate();
    return this.prepareState(
      await loadAllocationFacts(this.db),
      bookingId,
      options,
    );
  }
  // Internal 3B attachment: project the exact proposed resulting DB facts before
  // network work, then compare those facts after writing inside the mutex. Never
  // expose arbitrary facts or this prepared object as an HTTP request input.
  async prepareState(
    facts: AllocationFacts,
    bookingId: string,
    options: { candidateId?: string; ownHoldId?: string } = {},
  ): Promise<PreparedAllocation> {
    this.gate();
    const { target, reasons } = targetForBooking(facts, bookingId);
    const prepared: PreparedAllocation = {
      bookingId,
      ...options,
      factsFingerprint: fingerprint(facts),
      target,
      external: null,
      travelReasons: [],
      reasons,
    };
    if (!target) return prepared;
    const now = this.clock();
    prepared.external = await readExternalEvidence(
      facts,
      target,
      this.providers,
      now,
    );
    prepared.travelReasons = await verifyTravel(
      facts,
      target,
      excludeOwnHold(
        projectReservations(facts, target, now),
        options.ownHoldId,
      ),
      this.providers.estimator,
      now,
    );
    return prepared;
  }
  // No network inside the mutex. Call after the proposed mutation for 3B, with a
  // prepared snapshot matching that resulting state; changed evidence is review.
  async evaluateCommitmentIn(
    tx: QueryDatabase,
    prepared: PreparedAllocation,
  ): Promise<AllocationCheckDTO> {
    const now = this.clock(),
      facts = await loadAllocationFacts(tx),
      result = targetForBooking(facts, prepared.bookingId),
      target = result.target;
    let decision: CapacityDecision;
    if (!target || !prepared.target || !prepared.external)
      decision = review(...result.reasons, ...prepared.reasons);
    else {
      const projection = excludeOwnHold(
        projectReservations(facts, target, now),
        prepared.ownHoldId,
      );
      const reasons = [
        ...prepared.travelReasons,
        ...reconcileCalendar(facts, target, prepared.external),
      ];
      if (fingerprint(facts) !== prepared.factsFingerprint)
        reasons.push(
          "Booking, inventory, route or Calendar configuration changed during verification; retry.",
        );
      if (
        new Date(prepared.external.expiresAt) <= now ||
        new Date(prepared.external.checkedAt) > now
      )
        reasons.push(
          "Calendar/travel evidence expired; retry the fresh check.",
        );
      if (
        (facts.anchors ?? []).some(
          (a) =>
            !a.revoked_at &&
            new Date(a.valid_until) > new Date(prepared.external!.checkedAt) &&
            new Date(a.valid_until) <= now,
        )
      )
        reasons.push(
          "A route anchor expired during verification; record current availability evidence.",
        );
      if (
        facts.holds.some(
          (h) =>
            h.state === "active" &&
            new Date(h.expires_at) > new Date(prepared.external!.checkedAt) &&
            new Date(h.expires_at) <= now,
        )
      )
        reasons.push(
          "A route hold expired during verification; retry travel evidence.",
        );
      if (
        prepared.external.startsOn > target.startsOn ||
        prepared.external.endsOn < target.endsOn
      )
        reasons.push(
          "Calendar coverage does not contain the operational window.",
        );
      if (prepared.ownHoldId) {
        const hold = facts.holds.find((h) => h.id === prepared.ownHoldId);
        if (
          !hold ||
          hold.booking_id !== target.bookingId ||
          hold.state !== "active" ||
          new Date(hold.expires_at) <= now ||
          hold.demand_fingerprint !== target.demandFingerprint
        )
          reasons.push(
            "Referenced hold is expired or no longer matches this exact booking demand.",
          );
      }
      if (prepared.candidateId) {
        const c = await this.candidateBooking(tx, prepared.candidateId);
        if (
          c.booking_id !== target.bookingId ||
          c.released_at ||
          c.status !== "open"
        )
          reasons.push(
            "Candidate is released, changed or its opening is closed.",
          );
        if (
          target.eventStartsOn < c.starts_on ||
          target.eventEndsOn > c.ends_on ||
          target.legId !== c.leg_id
        )
          reasons.push(
            "Actual candidate event dates and leg must fit the opening.",
          );
        const openingQuantities = canonicalPackageQuantities(c.quantities);
        if (
          Object.entries(canonicalPackageQuantities(target.quantities)).some(
            ([code, q]) =>
              !openingQuantities[code] || q > openingQuantities[code],
          )
        )
          reasons.push(
            "Candidate package quantities exceed the opening's requested allocation.",
          );
      }
      decision = capacityDecision(target, projection, reasons);
    }
    return {
      capacity: decision,
      checkedAt: now.toISOString(),
      bookingId: prepared.bookingId,
      target,
      provenance: {
        calendarCheckedAt: prepared.external?.checkedAt ?? null,
        calendarExpiresAt: prepared.external?.expiresAt ?? null,
        calendarIds: prepared.external?.calendarIds ?? [],
        generation: facts.generation,
        calendarCoverage: prepared.external
          ? {
              startsOn: prepared.external.startsOn,
              endsOn: prepared.external.endsOn,
            }
          : null,
        calendarEventFingerprint: prepared.external
          ? fingerprint(prepared.external.events)
          : null,
        sourceErrors: prepared.external?.errors ?? [],
        factsFingerprint: fingerprint(facts),
        travelVerified:
          !!prepared.external &&
          !prepared.travelReasons.length &&
          decision.status !== "needs_review",
      },
      allocationEnforcementComplete: true,
    };
  }
  async evaluateCommitment(bookingId: string) {
    this.gate();
    const prepared = await this.prepare(bookingId);
    return withAllocationTransaction(this.db, (tx) =>
      this.evaluateCommitmentIn(tx, prepared),
    );
  }
  async evaluateCandidate(candidateId: string) {
    this.gate();
    try {
      return await this.evaluateCandidateAvailable(candidateId);
    } catch (error) {
      if (error instanceof OutreachError && error.status === 404) throw error;
      return {
        capacity: review(
          "Allocation source unavailable; restore Calendar, resource or booking evidence and retry.",
        ),
        checkedAt: this.clock().toISOString(),
        bookingId: null,
        target: null,
        provenance: {
          calendarCheckedAt: null,
          calendarExpiresAt: null,
          calendarIds: [],
          generation: null,
          calendarCoverage: null,
          calendarEventFingerprint: null,
          sourceErrors: ["Allocation evidence unavailable."],
          factsFingerprint: null,
          travelVerified: false,
        },
        allocationEnforcementComplete: true,
      } satisfies AllocationCheckDTO;
    }
  }
  private async evaluateCandidateAvailable(candidateId: string) {
    const c = await this.candidateBooking(this.db, candidateId);
    if (!c.booking_id)
      return {
        capacity: review("Candidate has no dated booking to allocate."),
        checkedAt: this.clock().toISOString(),
        bookingId: null,
        target: null,
        provenance: {
          calendarCheckedAt: null,
          calendarExpiresAt: null,
          calendarIds: [],
          generation: null,
          calendarCoverage: null,
          calendarEventFingerprint: null,
          sourceErrors: ["Allocation evidence unavailable."],
          factsFingerprint: null,
          travelVerified: false,
        },
        allocationEnforcementComplete: true,
      } satisfies AllocationCheckDTO;
    const holds = (await loadAllocationFacts(this.db)).holds;
    const own = holds.find(
      (h) =>
        h.candidate_id === candidateId &&
        h.booking_id === c.booking_id &&
        h.state === "active" &&
        new Date(h.expires_at) > this.clock(),
    );
    const prepared = await this.prepare(c.booking_id, {
      candidateId,
      ownHoldId: own?.id,
    });
    return withAllocationTransaction(this.db, (tx) =>
      this.evaluateCommitmentIn(tx, prepared),
    );
  }
  async saveDemand(candidateId: string, body: unknown, actor: string) {
    this.gate();
    const input = exactDemandInput.parse(body);
    return withAllocationTransaction(this.db, async (tx) => {
      await expireHoldsIn(tx, this.clock());
      const c = await this.candidateBooking(tx, candidateId);
      if (c.released_at || c.status !== "open" || !c.booking_id)
        throw new OutreachError(
          409,
          "Choose an active candidate with an existing booking.",
        );
      const facts = await loadAllocationFacts(tx),
        b = facts.bookings.find((b) => b.id === c.booking_id);
      if (!b) throw new OutreachError(404, "Booking not found.");
      if (
        facts.holds.some((h) => h.booking_id === b.id && h.state === "active")
      )
        throw new OutreachError(
          409,
          "Release the existing hold before changing exact demand.",
        );
      // Existing commitments are facts. 3B supplies the reconciliation/enforcement
      // entrypoint; this owner endpoint is for proposed demand only.
      if (isBookedForSchedule(b))
        throw new OutreachError(
          409,
          "Committed booking demand must be reconciled through the booking allocation workflow.",
        );
      if (
        Object.keys(input.quantities).some(
          (code) => !facts.packages.some((p) => p.code === code && p.active),
        )
      )
        throw new OutreachError(400, "Select configured active package codes.");
      if (
        input.resourceIds.some(
          (id) => !facts.resources.some((r) => r.id === id),
        )
      )
        throw new OutreachError(400, "Select existing physical resources.");
      const [value] = rowsOf<DemandFact>(
        await tx.execute(
          sql`insert into outreach_booking_demand(booking_id,quantities,resource_ids,facts_fingerprint,actor,reason,updated_at) values (${b.id}::uuid,${JSON.stringify(input.quantities)}::jsonb,${JSON.stringify([...input.resourceIds].sort())}::jsonb,${fingerprint(bookingDemandFacts(facts, b, input.resourceIds))},${actor},${input.reason},${this.clock()}) on conflict(booking_id) do update set quantities=excluded.quantities,resource_ids=excluded.resource_ids,facts_fingerprint=excluded.facts_fingerprint,actor=excluded.actor,reason=excluded.reason,updated_at=excluded.updated_at,revision=outreach_booking_demand.revision+1 returning *`,
        ),
      );
      await audit(tx, actor, "review_exact_demand", candidateId, {
        ...input,
        bookingId: b.id,
      });
      await invalidateAllocationIn(tx);
      return value;
    });
  }
  async list(): Promise<AllocationCatalogDTO> {
    this.gate();
    return withAllocationTransaction(this.db, async (tx) => {
      await expireHoldsIn(tx, this.clock());
      const facts = await loadAllocationFacts(tx);
      return {
        holds: facts.holds,
        demands: facts.demands,
        resources: facts.resources,
        anchors: facts.anchors ?? [],
        reconciliationFacts: rowsOf(
          await tx.execute(
            sql`select * from outreach_reconciliation_facts order by created_at desc limit 200`,
          ),
        ),
        allocationEnforcementComplete: true,
      };
    });
  }
  async createHold(candidateId: string, expiresAt: string, actor: string) {
    this.gate();
    holdExpiryInput.parse({ expiresAt });
    this.validExpiry(expiresAt);
    // Expiry is committed independently even if the subsequent allocation fails.
    await withAllocationTransaction(this.db, (tx) =>
      expireHoldsIn(tx, this.clock()),
    );
    const c = await this.candidateBooking(this.db, candidateId);
    if (!c.booking_id)
      throw new OutreachError(
        409,
        "Candidate needs an existing dated booking.",
      );
    const prepared = await this.prepare(c.booking_id, { candidateId });
    return withAllocationTransaction(this.db, async (tx) => {
      this.validExpiry(expiresAt);
      const planner = await new OutreachRepository(tx).load(this.clock());
      const candidate = planner.candidates.find((c) => c.id === candidateId);
      if (
        !candidate ||
        candidate.releasedAt ||
        candidate.waitingForCandidateId ||
        candidate.sources.protectedReason ||
        candidate.sources.reviewReasons.length ||
        candidate.outreach.state === "needs_review" ||
        candidate.outreach.state === "closed"
      )
        throw new OutreachError(
          409,
          "Resolve candidate priority, source/history or protection review before creating a hold.",
        );
      const facts = await loadAllocationFacts(tx);
      if (
        facts.holds.some(
          (h) =>
            h.booking_id === prepared.bookingId &&
            h.state === "active" &&
            new Date(h.expires_at) > this.clock(),
        )
      )
        throw new OutreachError(409, "Booking already has a live hold.");
      if (
        facts.bookings.some(
          (b) => b.id === prepared.bookingId && isBookedForSchedule(b),
        )
      )
        throw new OutreachError(
          409,
          "Booking is already committed; a second hold would double-count it.",
        );
      const check = await this.evaluateCommitmentIn(tx, prepared);
      this.requireFits(check.capacity);
      const t = check.target!;
      const [hold] = rowsOf<HoldFact>(
        await tx.execute(
          sql`insert into outreach_holds(candidate_id,booking_id,opportunity_id,leg_id,event_starts_on,event_ends_on,starts_on,ends_on,quantities,resource_ids,location,demand_fingerprint,owner,expires_at) values (${candidateId}::uuid,${t.bookingId}::uuid,${c.opportunity_id}::uuid,${t.legId}::uuid,${t.eventStartsOn}::date,${t.eventEndsOn}::date,${t.startsOn}::date,${t.endsOn}::date,${JSON.stringify(t.quantities)}::jsonb,${JSON.stringify(t.resourceIds)}::jsonb,${JSON.stringify(t.location)}::jsonb,${t.demandFingerprint},${actor},${new Date(expiresAt)}) returning *`,
        ),
      );
      await audit(tx, actor, "create_hold", hold.id, {
        hold,
        provenance: check.provenance,
      });
      await invalidateAllocationIn(tx);
      return hold;
    });
  }
  async releaseHold(holdId: string, actor: string) {
    this.gate();
    return withAllocationTransaction(this.db, async (tx) => {
      await expireHoldsIn(tx, this.clock());
      const [h] = rowsOf<HoldFact>(
        await tx.execute(
          sql`select * from outreach_holds where id=${holdId}::uuid`,
        ),
      );
      if (!h) throw new OutreachError(404, "Hold not found.");
      await assertNoUnresolvedHoldDispatch(tx, holdId);
      if (h.state !== "active") return h;
      const [value] = rowsOf<HoldFact>(
        await tx.execute(
          sql`update outreach_holds set state='released',ended_at=${this.clock()},revision=revision+1 where id=${holdId}::uuid returning *`,
        ),
      );
      await audit(tx, actor, "release_hold", holdId, {
        revision: value.revision,
      });
      await invalidateAllocationIn(tx);
      return value;
    });
  }
  async extendHold(holdId: string, expiresAt: string, actor: string) {
    this.gate();
    holdExpiryInput.parse({ expiresAt });
    this.validExpiry(expiresAt);
    const [h] = rowsOf<HoldFact>(
      await this.db.execute(
        sql`select * from outreach_holds where id=${holdId}::uuid`,
      ),
    );
    if (!h) throw new OutreachError(404, "Hold not found.");
    const prepared = await this.prepare(h.booking_id, {
      candidateId: h.candidate_id,
      ownHoldId: holdId,
    });
    return withAllocationTransaction(this.db, async (tx) => {
      this.validExpiry(expiresAt);
      const [current] = rowsOf<HoldFact>(
        await tx.execute(
          sql`select * from outreach_holds where id=${holdId}::uuid`,
        ),
      );
      if (
        !current ||
        current.state !== "active" ||
        new Date(current.expires_at) <= this.clock()
      )
        throw new OutreachError(
          409,
          "Expired or released holds cannot be extended.",
        );
      await assertNoUnresolvedHoldDispatch(tx, holdId);
      if (new Date(expiresAt) <= new Date(current.expires_at))
        throw new OutreachError(400, "Extension must move expiry later.");
      this.requireFits(
        (await this.evaluateCommitmentIn(tx, prepared)).capacity,
      );
      const [value] = rowsOf<HoldFact>(
        await tx.execute(
          sql`update outreach_holds set expires_at=${new Date(expiresAt)},revision=revision+1 where id=${holdId}::uuid returning *`,
        ),
      );
      await audit(tx, actor, "extend_hold", holdId, {
        expiresAt,
        revision: value.revision,
      });
      await invalidateAllocationIn(tx);
      return value;
    });
  }
  private validExpiry(value: string) {
    if (
      new Date(value) <= this.clock() ||
      new Date(value).getTime() > this.clock().getTime() + 30 * 86400000
    )
      throw new OutreachError(
        400,
        "Hold expiry must be in the future and within 30 days.",
      );
  }
  private requireFits(decision: CapacityDecision) {
    if (decision.status !== "fits")
      throw new OutreachError(
        409,
        `${decision.status}: ${decision.reasons.join(" ")}`,
      );
  }
}
