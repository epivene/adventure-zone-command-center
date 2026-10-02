import { sql } from "drizzle-orm";
import type { PlanFacts } from "@workspace/api-zod";
import { loadPlanFacts, planningFingerprint } from "./planning-facts";
import {
  PlanningError,
  planningRows,
  type PlanningDatabase,
} from "./planning-repository";
import { evaluatePlanReadiness } from "./readiness-policy";
import { evaluateApprovals } from "./approval-policy";
import { windowsOverlap } from "./operational-window";
import {
  withAllocationTransaction,
  type AllocationDatabase,
} from "../outreach-planner/outreach-allocation";
import { finishCapacityWriteIn } from "../outreach-planner/outreach-commitments";
export const planningEnabled = () =>
  process.env.LEG_PLANNING_ENABLED === "true";
export async function planningSnapshotIn(
  tx: PlanningDatabase,
): Promise<PlanFacts[]> {
  const rows = planningRows<{ booking_id: string }>(
    await tx.execute(sql`SELECT id AS booking_id FROM bookings ORDER BY id`),
  );
  return rows.length
    ? loadPlanFacts(
        tx,
        rows.map((r) => r.booking_id),
        { kind: "owner", subject: "internal-writer-check" },
        new Date(),
      )
    : [];
}
export async function checkPlanningWriteIn(
  tx: PlanningDatabase,
  before: PlanFacts[],
  after: PlanFacts[],
  mode: "commitment" | "reconciliation",
) {
  const oldObligations = before[0]
    ? [...before[0].obligations, ...before[0].holds]
    : [];
  const obligations = after[0]
    ? [...after[0].obligations, ...after[0].holds]
    : [];
  const oldAssignments = new Set(
    oldObligations.flatMap((o) => [
      ...o.resourceIds.map((id) => `${o.canonicalId}:resource:${id}`),
      ...o.workerIds.map((id) => `${o.canonicalId}:worker:${id}`),
    ]),
  );
  const newAssignments = obligations.some((o) =>
    [
      ...o.resourceIds.map((id) => `${o.canonicalId}:resource:${id}`),
      ...o.workerIds.map((id) => `${o.canonicalId}:worker:${id}`),
    ].some((key) => !oldAssignments.has(key)),
  );
  if (mode === "commitment" && newAssignments)
    for (let i = 0; i < obligations.length; i++)
      for (const other of obligations.slice(i + 1)) {
        const current = obligations[i];
        if (
          current.canonicalId === other.canonicalId ||
          (current.linkedBookingIds?.includes(other.bookingId) &&
            current.legId === other.legId) ||
          (other.linkedBookingIds?.includes(current.bookingId) &&
            current.legId === other.legId)
        )
          continue;
        const resourceConflict =
          windowsOverlap(current.window, other.window) &&
          current.resourceIds.some((id) => other.resourceIds.includes(id));
        const crewConflict = current.workerIds.some(
          (id) =>
            other.workerIds.includes(id) &&
            windowsOverlap(
              current.crewWindows?.find((w) => w.workerId === id)?.window ??
                current.window,
              other.crewWindows?.find((w) => w.workerId === id)?.window ??
                other.window,
            ),
        );
        if (resourceConflict || crewConflict)
          throw new PlanningError(
            409,
            "PLANNING_CONFLICT",
            "Crew or physical equipment has an overlapping commitment.",
          );
      }
  for (const f of after) {
    const previous = before.find((p) => p.booking.id === f.booking.id);
    const readiness = evaluatePlanReadiness(f, evaluateApprovals(f));
    const old =
      previous && evaluatePlanReadiness(previous, evaluateApprovals(previous));
    const oldPhysical = new Set(
      previous?.obligations.flatMap((o) =>
        o.resourceIds.map((id) => `${o.bookingId}:${id}`),
      ) ?? [],
    );
    const oldCrew = new Set(
      previous?.obligations.flatMap((o) =>
        o.workerIds.map((id) => `${o.bookingId}:${id}`),
      ) ?? [],
    );
    const newlyAssigned = f.obligations.some(
      (o) =>
        o.resourceIds.some((id) => !oldPhysical.has(`${o.bookingId}:${id}`)) ||
        o.workerIds.some((id) => !oldCrew.has(`${o.bookingId}:${id}`)),
    );
    const newConflicts = Object.values(readiness.dimensions)
      .flatMap((d) => d.reasons)
      .filter((r) =>
        [
          "RESOURCE_OVERLAP",
          "CREW_OVERLAP",
          "INSUFFICIENT_TRANSFER_TIME",
          "PACKAGE_CAPACITY_EXCEEDED",
          "LEG_OVERLAP",
        ].includes(r.code),
      );
    if (
      mode === "commitment" &&
      newlyAssigned &&
      f.committed &&
      newConflicts.length
    )
      throw new PlanningError(
        409,
        "PLANNING_CONFLICT",
        "The allocation conflicts with an existing operational plan.",
      );
    if (
      !previous ||
      planningFingerprint(previous) !== planningFingerprint(f) ||
      JSON.stringify(readiness.dimensions) !== JSON.stringify(old?.dimensions)
    )
      await tx.execute(
        sql`UPDATE leg_event_plans SET invalidation_reasons=${JSON.stringify(["Operational facts changed; review the current plan."])}::jsonb,revision=revision+1,updated_at=now() WHERE booking_id=${f.booking.id}::uuid`,
      );
  }
}
export async function planningWriterTransaction<T>(
  db: AllocationDatabase,
  work: (tx: AllocationDatabase) => Promise<T>,
  source: string,
  mode: "commitment" | "reconciliation" = "commitment",
) {
  return withAllocationTransaction(
    db,
    async (tx) => {
      const before = await planningSnapshotIn(tx);
      const result = await work(tx);
      await checkPlanningWriteIn(
        tx,
        before,
        await planningSnapshotIn(tx),
        mode,
      );
      await finishCapacityWriteIn(tx);
      return result;
    },
    { mode, source },
  );
}
