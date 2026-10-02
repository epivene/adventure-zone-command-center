import { parseBusinessDate } from "../../lib/business-date";
import type { OperationalWindow, PlanObligation } from "@workspace/api-zod";

/** Exact half-open instants for operating plans; legacy inclusive business-date policy stays unchanged. */
export function evaluateIntervalCapacity(input: {
  window: OperationalWindow;
  legId: string;
  quantities: Record<string, number>;
  reservations: PlanObligation[];
  excludeCanonicalId: string;
  splitBookingIds: string[];
}) {
  const unique = new Map<string, PlanObligation>(),
    mirrorConflicts: string[] = [];
  for (const r of input.reservations) {
    if (r.canonicalId === input.excludeCanonicalId) continue;
    const previous = unique.get(r.canonicalId);
    if (previous) {
      const q = (v: Record<string, number>) =>
        JSON.stringify(Object.entries(v).sort());
      if (
        previous.legId !== r.legId ||
        previous.window.startMs !== r.window.startMs ||
        previous.window.endMs !== r.window.endMs ||
        q(previous.packageQuantities) !== q(r.packageQuantities)
      )
        mirrorConflicts.push(r.canonicalId);
      previous.resourceIds = [
        ...new Set([...previous.resourceIds, ...r.resourceIds]),
      ];
      previous.workerIds = [
        ...new Set([...previous.workerIds, ...r.workerIds]),
      ];
      previous.window = {
        ...previous.window,
        startMs: Math.min(previous.window.startMs, r.window.startMs),
        endMs: Math.max(previous.window.endMs, r.window.endMs),
      };
      for (const [id, quantity] of Object.entries(r.packageQuantities))
        previous.packageQuantities[id] = Math.max(
          previous.packageQuantities[id] ?? 0,
          quantity,
        );
    } else unique.set(r.canonicalId, structuredClone(r));
  }
  const overlap = (w: OperationalWindow) =>
    w.startMs < input.window.endMs && input.window.startMs < w.endMs;
  const reservations = [...unique.values()],
    relevant = reservations.filter((r) => overlap(r.window));
  const points = [
    input.window.startMs,
    ...relevant
      .map((r) => r.window.startMs)
      .filter((p) => p >= input.window.startMs && p < input.window.endMs),
  ];
  const peak = { ...input.quantities };
  for (const p of points)
    for (const key of Object.keys(peak))
      peak[key] = Math.max(
        peak[key],
        (input.quantities[key] ?? 0) +
          relevant
            .filter((r) => r.window.startMs <= p && p < r.window.endMs)
            .reduce((sum, r) => sum + (r.packageQuantities[key] ?? 0), 0),
      );
  return {
    peak,
    reservations,
    relevant,
    mirrorConflicts,
    legConflicts: relevant
      .filter(
        (r) =>
          r.legId === input.legId &&
          !input.splitBookingIds.includes(r.bookingId),
      )
      .map((r) => r.bookingId),
  };
}
export type CapacityWindow = { startsOn: string; endsOn: string };
export type CapacityReservation = CapacityWindow & {
  id: string;
  canonicalId: string;
  legId: string | null;
  quantities: Record<string, number>;
  confidence: "verified" | "ambiguous";
};
export type CapacityInput = {
  window: CapacityWindow | null;
  legId: string | null;
  quantities: Record<string, number>;
  capacities: Record<string, number>;
  reservations: CapacityReservation[];
  evidenceVerified: boolean;
  travelVerified: boolean;
  excludeCanonicalId?: string | null;
};
export type CapacityDecision = {
  status: "fits" | "conflict" | "needs_review";
  reasons: string[];
};
const validWindow = (window: CapacityWindow | null): window is CapacityWindow =>
  !!window &&
  !!parseBusinessDate(window.startsOn) &&
  !!parseBusinessDate(window.endsOn) &&
  window.startsOn <= window.endsOn;
const validQuantities = (values: Record<string, number>, minimum: number) =>
  !!values &&
  Object.keys(values).length > 0 &&
  Object.entries(values).every(
    ([key, value]) =>
      key.trim() !== "" && Number.isSafeInteger(value) && value >= minimum,
  );
const overlaps = (a: CapacityWindow, b: CapacityWindow) =>
  a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
const signature = (reservation: CapacityReservation) =>
  JSON.stringify([
    reservation.startsOn,
    reservation.endsOn,
    reservation.legId,
    reservation.confidence,
    Object.entries(reservation.quantities).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  ]);
export function evaluateCapacity(input: CapacityInput): CapacityDecision {
  const review: string[] = [];
  if (!validWindow(input.window))
    review.push("A valid requested calendar window is required.");
  if (!input.legId?.trim()) review.push("Requested transport leg is missing.");
  if (!validQuantities(input.quantities, 1))
    review.push("Requested resource quantities must be positive integers.");
  if (!validQuantities(input.capacities, 0))
    review.push("Verified nonnegative integer inventory is required.");
  if (!input.evidenceVerified)
    review.push("Capacity evidence is not verified.");
  if (!input.travelVerified) review.push("Travel feasibility is not verified.");
  if (review.length) return { status: "needs_review", reasons: review };
  for (const resource of Object.keys(input.quantities)) {
    if (!Object.hasOwn(input.capacities, resource))
      review.push(`Inventory is missing for ${resource}.`);
  }
  const unique = new Map<string, CapacityReservation>();
  for (const reservation of input.reservations) {
    if (
      input.excludeCanonicalId &&
      reservation.canonicalId === input.excludeCanonicalId
    )
      continue;
    if (
      !reservation.id?.trim() ||
      !reservation.canonicalId?.trim() ||
      !validWindow(reservation) ||
      !validQuantities(reservation.quantities, 1)
    ) {
      review.push(
        "Existing reservation identity, window or quantities require review.",
      );
      continue;
    }
    const previous = unique.get(reservation.canonicalId);
    if (previous && signature(previous) !== signature(reservation))
      review.push(`Contradictory mirrors for ${reservation.canonicalId}.`);
    unique.set(reservation.canonicalId, reservation);
  }
  const relevant = [...unique.values()].filter((reservation) =>
    overlaps(input.window!, reservation),
  );
  for (const reservation of relevant) {
    if (!reservation.legId?.trim())
      review.push(
        `Reservation ${reservation.canonicalId} has no verified leg.`,
      );
    if (reservation.confidence !== "verified")
      review.push(
        `Reservation ${reservation.canonicalId} has ambiguous evidence.`,
      );
  }
  if (review.length) return { status: "needs_review", reasons: review };
  const conflicts: string[] = [];
  if (relevant.some((reservation) => reservation.legId === input.legId))
    conflicts.push("Requested leg is already reserved during this window.");
  // Occupancy can increase only at the requested start or a reservation start.
  // Inclusive date comparisons retain the outgoing reservation on its end date.
  const points = new Set([
    input.window!.startsOn,
    ...relevant
      .map((reservation) => reservation.startsOn)
      .filter((start) => start >= input.window!.startsOn),
  ]);
  for (const [resource, requested] of Object.entries(input.quantities)) {
    for (const point of points) {
      const occupied = relevant
        .filter(
          (reservation) =>
            reservation.startsOn <= point && point <= reservation.endsOn,
        )
        .reduce(
          (sum, reservation) => sum + (reservation.quantities[resource] ?? 0),
          0,
        );
      if (occupied + requested > input.capacities[resource]) {
        conflicts.push(`Insufficient ${resource} inventory on ${point}.`);
        break;
      }
    }
  }
  return conflicts.length
    ? { status: "conflict", reasons: conflicts }
    : { status: "fits", reasons: [] };
}
