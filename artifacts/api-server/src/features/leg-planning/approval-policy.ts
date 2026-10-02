import type {
  ApprovalDecisionInput,
  ApprovalEvaluation,
  ApprovalRequest,
  DecisionAuthorization,
  PlanFacts,
  PlanningActor,
} from "@workspace/api-zod";
import { planningFingerprint } from "./planning-facts";
import { resolveOperationalWindow, windowsOverlap } from "./operational-window";
import { evaluatePlanReadiness } from "./readiness-policy";

export function approvalFingerprint(
  facts: PlanFacts,
  request: ApprovalRequest,
) {
  return facts.approvalFingerprints?.[request.id] ?? planningFingerprint(facts);
}
export function decisionAuthority(
  actor: PlanningActor,
  request: ApprovalRequest,
  facts: PlanFacts,
): number | null {
  if (
    actor.kind === "manager" &&
    facts.managerAccessVersions !== undefined &&
    facts.managerAccessVersions[actor.legId] !== actor.sessionVersion
  )
    return null;
  if (
    actor.kind === "boss" &&
    facts.authorityEnabled &&
    facts.authority?.accountId === actor.accountId &&
    (facts.authoritySessionVersion === undefined ||
      facts.authoritySessionVersion === actor.sessionVersion)
  )
    return facts.authority.revision;
  if (
    request.type === "split" &&
    actor.kind === "manager" &&
    actor.legId === request.parentLegId &&
    facts.season?.legId === actor.legId &&
    facts.season.leadership === "confirmed"
  )
    return facts.season.revision;
  return null;
}
export function evaluateApprovals(facts: PlanFacts): ApprovalEvaluation {
  const result: ApprovalEvaluation = {
    state: "passed",
    reasons: [],
    splitGroupIds: [],
    extraAdventureZone: false,
    extraPirates: false,
  };
  const latestRequests = new Map<string, ApprovalRequest>();
  for (const request of facts.requests
    .slice()
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    ))
    latestRequests.set(
      `${request.type}:${request.bookingIds.slice().sort().join(":")}`,
      request,
    );
  for (const request of latestRequests.values()) {
    const decisions = facts.decisions
      .filter((d) => d.requestId === request.id)
      .sort(
        (a, b) =>
          a.decidedAt.localeCompare(b.decidedAt) || a.id.localeCompare(b.id),
      );
    const latest = decisions.at(-1);
    if (!latest) {
      if (result.state === "passed") result.state = "pending";
      result.reasons.push("Awaiting an attributed decision.");
      continue;
    }
    const valid =
      latest.decision === "approved" &&
      request.planFingerprint === approvalFingerprint(facts, request) &&
      latest.planFingerprint === request.planFingerprint &&
      decisionAuthority(latest.actor, request, facts) ===
        latest.authorityRevision;
    if (!valid) {
      result.state = "invalid";
      result.reasons.push(
        "Approval was declined, revoked or its plan/authority changed. Request a fresh review.",
      );
      continue;
    }
    if (
      request.type === "split" &&
      facts.split &&
      request.bookingIds.length === 2 &&
      request.bookingIds.every((id) => facts.split!.bookingIds.includes(id))
    )
      result.splitGroupIds.push(facts.split.id);
    if (request.type === "extra_adventure_zone")
      result.extraAdventureZone = true;
    if (request.type === "extra_pirates") result.extraPirates = true;
  }
  return result;
}
function splitFeasible(facts: PlanFacts, request: ApprovalRequest): boolean {
  const split = facts.split,
    branches = facts.branches;
  if (
    !split ||
    split.parentLegId !== request.parentLegId ||
    request.bookingIds.length !== 2 ||
    branches.length !== 2 ||
    !request.bookingIds.every((id) => split.bookingIds.includes(id))
  )
    return false;
  if (
    branches.some(
      (b) =>
        b.legId !== split.parentLegId ||
        b.splitGroupId !== split.id ||
        b.seasonYear !== facts.draft.seasonYear,
    )
  )
    return false;
  const windows = branches.map(
    (b) => b.window && resolveOperationalWindow(b.window),
  );
  if (windows.some((w) => w?.state !== "resolved")) return false;
  for (const b of branches) {
    if (
      b.requirements.minimumCrew == null ||
      b.requirements.roles == null ||
      b.crew.filter((c) => c.state === "confirmed").length <
        b.requirements.minimumCrew
    )
      return false;
    if (
      Object.entries(b.requirements.roles).some(
        ([role, count]) =>
          b.crew.filter((c) => c.state === "confirmed" && c.role === role)
            .length < count,
      )
    )
      return false;
  }
  if (
    windows[0]?.state === "resolved" &&
    windows[1]?.state === "resolved" &&
    windowsOverlap(windows[0].window, windows[1].window)
  ) {
    if (
      branches[0].crew.some((c) =>
        branches[1].crew.some((other) => other.workerId === c.workerId),
      )
    )
      return false;
    const resources = branches.map(
      (b) =>
        new Set([
          ...b.transportResourceIds,
          ...facts.packageSets
            .filter((s) => b.packageSetIds.includes(s.id))
            .flatMap((s) => s.resourceIds),
        ]),
    );
    if ([...resources[0]].some((id) => resources[1].has(id))) return false;
  }
  return true;
}
export function authorizeDecision(
  actor: PlanningActor,
  request: ApprovalRequest,
  facts: PlanFacts,
  input: ApprovalDecisionInput,
): DecisionAuthorization {
  if (decisionAuthority(actor, request, facts) == null)
    return { allowed: false, code: "AUTHORITY_REQUIRED" };
  if (request.planFingerprint !== approvalFingerprint(facts, request))
    return { allowed: false, code: "STALE_APPROVAL" };
  if (input.decision !== "approved") return { allowed: true };
  if (request.type === "split") {
    if (!splitFeasible(facts, request))
      return { allowed: false, code: "PLAN_CONFLICT" };
    const twoAZ = facts.branches.every((b) =>
      facts.packageSets.some(
        (s) =>
          b.packageSetIds.includes(s.id) &&
          facts.packages.some(
            (p) => p.id === s.packageId && p.code === "adventure_zone",
          ),
      ),
    );
    if (twoAZ && !input.strategicAcknowledgement)
      return { allowed: false, code: "EVIDENCE_REQUIRED" };
  }
  const prospective = evaluateApprovals(facts);
  prospective.state = "passed";
  prospective.reasons = [];
  if (request.type === "split" && facts.split)
    prospective.splitGroupIds = [
      ...new Set([...prospective.splitGroupIds, facts.split.id]),
    ];
  if (request.type === "extra_adventure_zone")
    prospective.extraAdventureZone = true;
  if (request.type === "extra_pirates") prospective.extraPirates = true;
  const readiness = evaluatePlanReadiness(facts, prospective);
  const dimensions = [
    readiness.dimensions.crew,
    readiness.dimensions.equipment,
    readiness.dimensions.dates_travel,
    readiness.dimensions.accommodation,
  ];
  if (dimensions.some((d) => d.state === "conflict"))
    return { allowed: false, code: "PLAN_CONFLICT" };
  if (dimensions.some((d) => d.state !== "verified_plan"))
    return { allowed: false, code: "EVIDENCE_REQUIRED" };
  return { allowed: true };
}
