import type {
  EventPlan,
  PlanFacts,
  PlanningActor,
  PlanningRead,
} from "@workspace/api-zod";
import { assertPlanningLeg } from "./planning-repository";
import { evaluateApprovals, decisionAuthority } from "./approval-policy";
import { evaluatePlanReadiness } from "./readiness-policy";
export function toPlanningView(
  facts: PlanFacts,
  actor: PlanningActor,
  plan?: EventPlan | null,
): PlanningRead {
  assertPlanningLeg(actor, facts.booking.legId);
  assertPlanningLeg(actor, facts.draft.legId);
  const readiness = evaluatePlanReadiness(facts, evaluateApprovals(facts));
  if (actor.kind === "manager")
    for (const d of Object.values(readiness.dimensions))
      d.reasons = d.reasons.map((r) => ({
        ...r,
        href: `/manager/operations?bookingId=${facts.booking.id}`,
      }));
  const requests = facts.requests.filter(
    (r) =>
      r.bookingIds.includes(facts.booking.id) &&
      (actor.kind !== "manager" ||
        (r.parentLegId === actor.legId &&
          r.bookingIds.every(
            (id) =>
              !facts.bookingLegIds || facts.bookingLegIds[id] === actor.legId,
          ))),
  );
  return {
    split:
      facts.split &&
      (actor.kind !== "manager" ||
        facts.split.bookingIds.every(
          (id) =>
            !facts.bookingLegIds || facts.bookingLegIds[id] === actor.legId,
        ))
        ? facts.split
        : null,
    plan:
      plan === undefined
        ? facts.revision
          ? {
              bookingId: facts.booking.id,
              revision: facts.revision,
              draft: facts.draft,
              committed: facts.committed ?? null,
              invalidationReasons: [],
            }
          : null
        : plan,
    draft: facts.draft,
    readiness,
    requests,
    decisions: facts.decisions.filter((d) =>
      requests.some((r) => r.id === d.requestId),
    ),
    actions: {
      edit: true,
      commit: true,
      request: true,
      decide: requests.some((r) => decisionAuthority(actor, r, facts) != null),
    },
    travelReviewContext: {
      endpointFingerprint: facts.travel.endpointFingerprint,
      verified: facts.travel.verified,
      reasons: facts.travel.reasons,
    },
  };
}
