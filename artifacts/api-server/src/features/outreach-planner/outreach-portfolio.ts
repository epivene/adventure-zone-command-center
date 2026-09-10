import type {
  CandidateDTO,
  CandidateWaitingDTO,
  PlannerDTO,
} from "./outreach-dto";
import { isBookedForSchedule } from "../calendar/schedule-booking-state";
import { compareOutreachPriority } from "./outreach-policy";
import {
  capacityDecision,
  canonicalPackageQuantities,
  excludeOwnHold,
  projectReservations,
  type AllocationFacts,
  type AllocationTarget,
} from "./outreach-capacity-evidence";
const overlaps = (a: AllocationTarget, b: AllocationTarget) =>
  a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
const attention = (c: CandidateDTO) =>
  !!(
    c.sources.manualNextActions.length ||
    c.decisionDueAt ||
    c.meaningfulReplyAt ||
    c.sources.observedInterestAt ||
    c.sources.observedConversationAt ||
    ["reply", "decision"].includes(c.outreach.state)
  );
type Pursuit = { candidate: CandidateDTO; target: AllocationTarget };
/** Current individual checks know established stops, but not another unheld
 * pursuit. Identify only newly adjacent prospective edges, independently for
 * each leg and physical resource. An intervening established stop retains the
 * existing independently verified route edges. */
function unverifiedAdjacentPursuits(
  target: AllocationTarget,
  established: AllocationTarget[],
  prospective: Pursuit[],
): Pursuit[] {
  const combined = [...established, ...prospective.map((p) => p.target)];
  const routes = [
    combined.filter((stop) => stop.legId === target.legId),
    ...target.resourceIds.map((id) =>
      combined.filter((stop) => stop.resourceIds.includes(id)),
    ),
  ];
  const unverified = new Set<string>();
  for (const route of routes) {
    const previous = route.filter((stop) => stop.endsOn < target.startsOn);
    const next = route.filter((stop) => stop.startsOn > target.endsOn);
    const previousBoundary = previous
      .map((stop) => stop.endsOn)
      .sort()
      .at(-1);
    const nextBoundary = next.map((stop) => stop.startsOn).sort()[0];
    for (const stop of [
      ...previous.filter((stop) => stop.endsOn === previousBoundary),
      ...next.filter((stop) => stop.startsOn === nextBoundary),
    ])
      if (prospective.some((p) => p.target === stop))
        unverified.add(stop.bookingId);
  }
  return prospective.filter((p) => unverified.has(p.target.bookingId));
}
/** Advisory pursuit selection only. Nothing here reserves or releases equipment. */
export function applyPortfolioPriority(
  planner: PlannerDTO,
  facts: AllocationFacts | null,
  now: Date,
) {
  const selected: Pursuit[] = [];
  const named = (c: CandidateDTO, reason: string): CandidateWaitingDTO => ({
    candidateId: c.id,
    organizationName: c.organizationName,
    openingId: c.openingId,
    openingTitle:
      planner.openings.find((o) => o.id === c.openingId)?.title ?? "Opening",
    reason,
  });
  for (const c of [...planner.candidates].sort(compareOutreachPriority)) {
    const check = c.lastAllocationCheck,
      target = check?.target;
    if (c.releasedAt || c.outreach.state === "closed") {
      c.portfolio = {
        state: "inactive",
        reason: "Pursuit is closed.",
        competing: [],
      };
      continue;
    }
    const active = attention(c);
    if (
      !facts ||
      !target ||
      check?.freshness !== "current" ||
      c.capacity.status !== "fits"
    ) {
      c.portfolio = {
        state: active ? "attention" : "needs_review",
        reason: active
          ? "Keep this conversation or callback visible; capacity still needs review."
          : "Current verified event, route and capacity facts are required.",
        competing: [],
      };
      continue;
    }
    if (c.waitingFor && !active) {
      c.portfolio = {
        state: "waiting",
        reason: c.waitingFor.reason,
        competing: [c.waitingFor],
      };
      continue;
    }
    const projection = excludeOwnHold(
      projectReservations(facts, target, now),
      c.liveHoldId ?? undefined,
    );
    const virtual = selected.filter(
      (s) =>
        !s.candidate.liveHoldId &&
        s.target.bookingId !== target.bookingId &&
        !projection.reservations.some(
          (r) => r.canonicalId === `booking:${s.target.bookingId}`,
        ),
    );
    const relevant = virtual.filter((s) => overlaps(target, s.target));
    for (const s of virtual)
      projection.reservations.push({
        id: s.candidate.id,
        canonicalId: `pursuit:${s.candidate.id}`,
        startsOn: s.target.startsOn,
        endsOn: s.target.endsOn,
        legId: s.target.legId,
        quantities: {
          ...Object.fromEntries(
            Object.entries(canonicalPackageQuantities(s.target.quantities)).map(
              ([code, q]) => [`package:${code}`, q],
            ),
          ),
          ...Object.fromEntries(
            s.target.resourceIds.map((id) => [`resource:${id}`, 1]),
          ),
        },
        confidence: "verified",
      });
    const shared = relevant.filter((s) =>
      s.target.resourceIds.some((r) => target.resourceIds.includes(r)),
    );
    const decision = capacityDecision(target, projection, []);
    if (decision.status !== "fits" || shared.length) {
      const competitors = (shared.length ? shared : relevant).map((s) =>
        named(
          s.candidate,
          `${s.candidate.organizationName} has first-choice pursuit priority for competing equipment or packages.`,
        ),
      );
      const reason = competitors.length
        ? `Waiting for ${competitors.map((x) => `${x.organizationName} (${x.openingTitle})`).join(", ")} because their verified event windows compete for available equipment or packages.`
        : "Capacity facts require a fresh review.";
      c.portfolio = {
        state: active
          ? "attention"
          : decision.status === "needs_review"
            ? "needs_review"
            : "waiting",
        reason,
        competing: competitors,
      };
      continue;
    }
    // An established target was already a stop in every selected pursuit's
    // current individual check. Otherwise any new prospective adjacent edge
    // needs its own travel proof; GET has no provider evidence for that edge.
    const targetIsEstablished =
      facts.bookings.some(
        (booking) =>
          booking.id === target.bookingId && isBookedForSchedule(booking),
      ) ||
      facts.holds.some(
        (hold) =>
          hold.id === c.liveHoldId &&
          hold.booking_id === target.bookingId &&
          hold.state === "active" &&
          new Date(hold.expires_at) > now,
      );
    const routeCompetitors = targetIsEstablished
      ? []
      : unverifiedAdjacentPursuits(target, projection.stops, virtual);
    if (routeCompetitors.length) {
      const competing = routeCompetitors.map((p) =>
        named(
          p.candidate,
          `Travel between this event and ${p.candidate.organizationName} has not been verified for their shared leg or equipment.`,
        ),
      );
      c.portfolio = {
        state: active ? "attention" : "needs_review",
        reason: `Shared-route travel needs review with ${competing.map((p) => `${p.organizationName} (${p.openingTitle})`).join(", ")}. Individual allocation checks do not verify travel between unheld pursuits.`,
        competing,
      };
      continue;
    }
    if (
      (!["ready", "follow_up"].includes(c.outreach.state) ||
        (c.outreach.dueAt && new Date(c.outreach.dueAt) > now)) &&
      !active &&
      !c.liveHoldId
    ) {
      c.portfolio = {
        state: "waiting",
        reason: c.outreach.reason,
        competing: [],
      };
      continue;
    }
    c.portfolio = {
      state: active ? "attention" : "first_choice",
      reason: active
        ? "Active conversation remains visible. Conversation itself does not reserve equipment."
        : "First-choice pursuit using current verified capacity; a live hold is required for a specific offer.",
      competing: [],
    };
    selected.push({ candidate: c, target });
  }
}
