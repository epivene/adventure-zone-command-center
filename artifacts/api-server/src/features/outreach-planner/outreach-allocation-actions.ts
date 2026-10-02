import { z } from "zod";
import { sql } from "drizzle-orm";
import { exactDemandInput } from "./outreach-dto";
import { OutreachError } from "./outreach-repository";
import {
  OutreachAllocation,
  withAllocationTransaction,
  invalidateAllocationIn,
} from "./outreach-allocation";
import {
  anchorIdentity,
  bookingDemandFacts,
  fingerprint,
  loadAllocationFacts,
  semanticAllocationFacts,
  type AllocationFacts,
  type DemandFact,
  type RouteAnchorFact,
} from "./outreach-capacity-evidence";
import {
  commitmentTransaction,
  reconcileCapacityFacts,
} from "./outreach-commitments";
import { isBookedForSchedule } from "../calendar/schedule-booking-state";
import { rowsOf } from "./outreach-sources";
const instant = z.string().datetime({ offset: true });
export const routeAnchorInput = z
  .object({
    legId: z.string().uuid().nullable(),
    resourceId: z.string().uuid().nullable(),
    direction: z.enum(["departure", "return"]),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    availableAt: instant,
    validUntil: instant,
    source: z.string().trim().min(1).max(2000),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict()
  .refine(
    (x) => Boolean(x.legId) !== Boolean(x.resourceId),
    "Choose exactly one actual leg or physical resource.",
  );
export const commitmentChangeInput = z
  .object({
    startsAt: instant,
    endsAt: instant,
    travelLegId: z.string().uuid(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    demand: exactDemandInput,
  })
  .strict()
  .refine(
    (x) => new Date(x.startsAt) <= new Date(x.endsAt),
    "Event end must follow event start.",
  );
function validateDemand(
  f: AllocationFacts,
  input: z.infer<typeof exactDemandInput>,
) {
  if (
    Object.keys(input.quantities).some(
      (code) => !f.packages.some((p) => p.code === code && p.active),
    )
  )
    throw new OutreachError(400, "Select configured active package codes.");
  if (input.resourceIds.some((id) => !f.resources.some((r) => r.id === id)))
    throw new OutreachError(400, "Select existing physical resources.");
}
async function writeDemand(
  tx: Parameters<OutreachAllocation["evaluateCommitmentIn"]>[0],
  d: DemandFact,
) {
  return rowsOf<DemandFact>(
    await tx.execute(
      sql`insert into outreach_booking_demand(booking_id,quantities,resource_ids,facts_fingerprint,revision,actor,reason,updated_at) values (${d.booking_id}::uuid,${JSON.stringify(d.quantities)}::jsonb,${JSON.stringify(d.resource_ids)}::jsonb,${d.facts_fingerprint},${d.revision},${d.actor},${d.reason},${d.updated_at}::timestamptz) on conflict(booking_id) do update set quantities=excluded.quantities,resource_ids=excluded.resource_ids,facts_fingerprint=excluded.facts_fingerprint,revision=excluded.revision,actor=excluded.actor,reason=excluded.reason,updated_at=excluded.updated_at returning *`,
    ),
  )[0];
}
export async function saveRouteAnchor(
  a: OutreachAllocation,
  body: unknown,
  actor: string,
) {
  a.gate();
  const input = routeAnchorInput.parse(body),
    now = a.clock();
  if (
    new Date(input.validUntil) <= now ||
    new Date(input.validUntil) < new Date(input.availableAt)
  )
    throw new OutreachError(
      400,
      "Anchor verification must remain valid through its availability time.",
    );
  return withAllocationTransaction(a.db, async (tx) => {
    const facts = await loadAllocationFacts(tx);
    if (
      (input.legId &&
        !facts.legs.some((l) => l.id === input.legId && !l.archived_at)) ||
      (input.resourceId &&
        !facts.resources.some((r) => r.id === input.resourceId))
    )
      throw new OutreachError(
        400,
        "Choose an existing active leg or actual physical resource.",
      );
    const identity = anchorIdentity(facts, {
      leg_id: input.legId,
      resource_id: input.resourceId,
    });
    const superseded = rowsOf<{ id: string }>(
      await tx.execute(
        sql`update outreach_route_anchors set revoked_at=${now},revision=revision+1 where revoked_at is null and direction=${input.direction} and leg_id is not distinct from ${input.legId}::uuid and resource_id is not distinct from ${input.resourceId}::uuid returning id`,
      ),
    );
    const [anchor] = rowsOf<RouteAnchorFact>(
      await tx.execute(
        sql`insert into outreach_route_anchors(leg_id,resource_id,direction,latitude,longitude,available_at,valid_until,source,reason,actor,identity_fingerprint,recorded_at) values (${input.legId}::uuid,${input.resourceId}::uuid,${input.direction},${input.latitude},${input.longitude},${input.availableAt}::timestamptz,${input.validUntil}::timestamptz,${input.source},${input.reason},${actor},${identity},${now}) returning *`,
      ),
    );
    await tx.execute(
      sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'record_route_anchor',${anchor.id}::uuid,${JSON.stringify({ ...input, superseded: superseded.map((a) => a.id) })}::jsonb)`,
    );
    await invalidateAllocationIn(tx);
    return anchor;
  });
}
export async function revokeRouteAnchor(
  a: OutreachAllocation,
  id: string,
  body: unknown,
  actor: string,
) {
  a.gate();
  const { reason } = z
    .object({ reason: z.string().trim().min(1).max(4000) })
    .strict()
    .parse(body);
  return withAllocationTransaction(a.db, async (tx) => {
    const [anchor] = rowsOf<RouteAnchorFact>(
      await tx.execute(
        sql`update outreach_route_anchors set revoked_at=coalesce(revoked_at,${a.clock()}),revision=revision+1 where id=${id}::uuid returning *`,
      ),
    );
    if (!anchor) throw new OutreachError(404, "Route anchor not found.");
    await tx.execute(
      sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'revoke_route_anchor',${id}::uuid,${JSON.stringify({ reason })}::jsonb)`,
    );
    await invalidateAllocationIn(tx);
    return anchor;
  });
}
export async function reconcileCommittedDemand(
  a: OutreachAllocation,
  id: string,
  body: unknown,
  actor: string,
) {
  a.gate();
  const input = exactDemandInput.parse(body);
  const demand = await reconcileCapacityFacts(
    a.db,
    "committed-demand-review",
    async (tx) => {
      const facts = await loadAllocationFacts(tx),
        b = facts.bookings.find((b) => b.id === id);
      if (!b || !isBookedForSchedule(b))
        throw new OutreachError(
          409,
          "This action only records exact demand for an existing factual commitment; it cannot create a commitment.",
        );
      if (facts.holds.some((h) => h.booking_id === id && h.state === "active"))
        throw new OutreachError(
          409,
          "Resolve the existing hold before reconciling committed demand.",
        );
      validateDemand(facts, input);
      const selected = facts.selections
        .filter((s) => s.booking_id === id)
        .map(
          (s) =>
            facts.packages.find((p) => p.id === s.package_template_id)?.code,
        )
        .sort();
      const assigned = facts.assignments
        .filter((s) => s.booking_id === id)
        .map((s) => s.resource_id)
        .sort();
      if (
        fingerprint(selected) !==
          fingerprint(Object.keys(input.quantities).sort()) ||
        assigned.some((r) => !input.resourceIds.includes(r))
      )
        throw new OutreachError(
          409,
          "Demand must match selected packages and include every assigned physical resource.",
        );
      for (const resourceId of input.resourceIds)
        await tx.execute(
          sql`insert into booking_resource_assignments(booking_id,resource_id) select ${id}::uuid,${resourceId}::uuid where not exists(select 1 from booking_resource_assignments where booking_id=${id}::uuid and resource_id=${resourceId}::uuid)`,
        );
      const reconciled = await loadAllocationFacts(tx);
      const d: DemandFact = {
        booking_id: id,
        quantities: input.quantities,
        resource_ids: [...input.resourceIds].sort(),
        facts_fingerprint: fingerprint(
          bookingDemandFacts(reconciled, b, input.resourceIds),
        ),
        revision:
          (facts.demands.find((d) => d.booking_id === id)?.revision ?? 0) + 1,
        actor,
        reason: input.reason,
        updated_at: a.clock().toISOString(),
      };
      const saved = await writeDemand(tx, d);
      await tx.execute(
        sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'reconcile_committed_demand',${id}::uuid,${JSON.stringify(input)}::jsonb)`,
      );
      return saved;
    },
    { actor, reason: input.reason },
  );
  // Recording a fact is durable even if Calendar or routing cannot be verified.
  const prepared = await a.prepare(id);
  const check = await withAllocationTransaction(a.db, async (tx) => {
    const check = await a.evaluateCommitmentIn(tx, prepared);
    if (check.capacity.status === "fits")
      await tx.execute(
        sql`update outreach_reconciliation_facts set state='resolved',resolved_at=${a.clock()} where state='needs_review' and source<>'assistant-history-import' and booking_ids=${JSON.stringify([id])}::jsonb`,
      );
    return check;
  });
  return { demand, check };
}
export async function changeCommitment(
  a: OutreachAllocation,
  id: string,
  body: unknown,
  actor: string,
) {
  a.gate();
  const input = commitmentChangeInput.parse(body),
    at = a.clock().toISOString();
  let resultDemand: DemandFact;
  const project = (facts: AllocationFacts) => {
    const b = facts.bookings.find((b) => b.id === id);
    if (!b) throw new OutreachError(404, "Booking not found.");
    validateDemand(facts, input.demand);
    const dates=b.date_provenance;
    const sameEndpoint=(value:string,raw:string|null,effective:string|null)=>
      [raw,effective].some(saved=>saved&&new Date(saved).getTime()===new Date(value).getTime());
    if(!dates?.publicWindow || !sameEndpoint(input.startsAt,dates.rawPublic.start,b.starts_at) || !sameEndpoint(input.endsAt,dates.rawPublic.end,b.ends_at))
      throw new OutreachError(409,"Use booking date repairs with saved source evidence before changing event dates.");
    if (
      facts.holds.some(
        (h) =>
          h.booking_id === id &&
          h.state === "active" &&
          new Date(h.expires_at) > a.clock(),
      )
    )
      throw new OutreachError(
        409,
        "Release the existing hold before changing its exact demand.",
      );
    Object.assign(b, {
      travel_leg_id: input.travelLegId,
      latitude: input.latitude,
      longitude: input.longitude,
    });
    facts.selections = [
      ...facts.selections.filter((s) => s.booking_id !== id),
      ...Object.keys(input.demand.quantities).map((code) => ({
        booking_id: id,
        package_template_id: facts.packages.find((p) => p.code === code)!.id,
      })),
    ].sort(
      (a, b) =>
        a.booking_id.localeCompare(b.booking_id) ||
        a.package_template_id.localeCompare(b.package_template_id),
    );
    facts.assignments = [
      ...facts.assignments.filter((s) => s.booking_id !== id),
      ...input.demand.resourceIds.map((resource_id) => ({
        booking_id: id,
        resource_id,
      })),
    ].sort(
      (a, b) =>
        a.booking_id.localeCompare(b.booking_id) ||
        a.resource_id.localeCompare(b.resource_id),
    );
    resultDemand = {
      booking_id: id,
      quantities: input.demand.quantities,
      resource_ids: [...input.demand.resourceIds].sort(),
      facts_fingerprint: fingerprint(
        bookingDemandFacts(facts, b, input.demand.resourceIds),
      ),
      revision:
        (facts.demands.find((d) => d.booking_id === id)?.revision ?? 0) + 1,
      actor,
      reason: input.demand.reason,
      updated_at: at,
    };
    facts.demands = [
      ...facts.demands.filter((d) => d.booking_id !== id),
      resultDemand,
    ].sort((a, b) => a.booking_id.localeCompare(b.booking_id));
    return semanticAllocationFacts(facts);
  };
  return commitmentTransaction(
    a.db,
    async (tx) => {
      await tx.execute(
        sql`update bookings set travel_leg_id=${input.travelLegId}::uuid,latitude=${input.latitude},longitude=${input.longitude} where id=${id}::uuid`,
      );
      await tx.execute(
        sql`delete from booking_package_selections where booking_id=${id}::uuid`,
      );
      for (const code of Object.keys(input.demand.quantities))
        await tx.execute(
          sql`insert into booking_package_selections(booking_id,package_template_id) select ${id}::uuid,id from package_templates where code=${code}`,
        );
      await tx.execute(
        sql`delete from booking_resource_assignments where booking_id=${id}::uuid and not (resource_id::text in (select jsonb_array_elements_text(${JSON.stringify(input.demand.resourceIds)}::jsonb)))`,
      );
      for (const r of input.demand.resourceIds)
        await tx.execute(
          sql`insert into booking_resource_assignments(booking_id,resource_id) select ${id}::uuid,${r}::uuid where not exists(select 1 from booking_resource_assignments where booking_id=${id}::uuid and resource_id=${r}::uuid)`,
        );
      const demand = await writeDemand(tx, resultDemand!);
      await tx.execute(
        sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'change_commitment',${id}::uuid,${JSON.stringify(input)}::jsonb)`,
      );
      return { demand };
    },
    {
      project,
      bookingIds: [id],
      actor,
      source: "owner-reviewed-commitment-change",
    },
    a,
  );
}

export async function reviewImportedClaimSource(
  a: OutreachAllocation,
  id: string,
  body: unknown,
  actor: string,
) {
  a.gate();
  const input = z
    .object({
      existingExternalCommitmentConfirmed: z.literal(true),
      sourceReference: z.string().trim().min(1).max(2000),
      reason: z.string().trim().min(1).max(4000),
    })
    .strict()
    .parse(body);
  return withAllocationTransaction(a.db, async (tx) => {
    const [claim] = rowsOf<{ id: string; state: string }>(
      await tx.execute(
        sql`select id,state from outreach_reconciliation_facts where id=${id}::uuid and source='assistant-history-import' for update`,
      ),
    );
    if (!claim)
      throw new OutreachError(404, "Imported commitment claim not found.");
    await tx.execute(
      sql`update outreach_reconciliation_facts set state='resolved',resolved_at=${a.clock()},detail=detail || ${JSON.stringify({ sourceReview: { ...input, actor, reviewedAt: a.clock().toISOString() } })}::jsonb where id=${id}::uuid`,
    );
    await tx.execute(
      sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'review_imported_commitment_source',${id}::uuid,${JSON.stringify(input)}::jsonb)`,
    );
    await invalidateAllocationIn(tx);
    return { id, state: "resolved", capacityReviewRequired: true };
  });
}
