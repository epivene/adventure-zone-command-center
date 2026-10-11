import type { LegAssignmentDecision } from "./leg-assignment-domain";
import { needsLegAssignmentDecision } from "./leg-assignment-domain";
import {
  evaluateLegFeasibility,
  type DriveTimeEstimator,
  type FeasibilityResult,
} from "./leg-feasibility";
import type {
  AssignmentCandidateContext,
  LegAssignmentStore,
} from "./leg-assignment-repository";

export type EvaluatedCandidate = AssignmentCandidateContext & {
  feasibility: FeasibilityResult;
  routeDriveMinutes: number | null;
};

function routeDriveMinutes(result: FeasibilityResult) {
  const values = [result.previousDriveMinutes, result.nextDriveMinutes].filter(
    (value): value is number => value !== null,
  );
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function warningLabel(warning: LegAssignmentDecision["warning"]) {
  if (warning === "major_travel_concern") return " · Major travel concern";
  if (warning === "long_travel") return " · Long travel";
  return "";
}

function routeExplanation(candidate: EvaluatedCandidate) {
  const travel = candidate.routeDriveMinutes === null
    ? "route travel unavailable"
    : `${Math.round(candidate.routeDriveMinutes / 60 * 10) / 10}h surrounding travel`;
  return `${candidate.legName} has ${candidate.confirmedEventCount} confirmed events · ${travel}${warningLabel(candidate.feasibility.warning)}`;
}

export class LegAssignmentService {
  constructor(
    private readonly repository: LegAssignmentStore,
    private readonly estimator: DriveTimeEstimator,
  ) {}

  async evaluate(bookingId: string, options: { allowAutomaticAssignment?: boolean } = {}): Promise<LegAssignmentDecision> {
    const allowAutomaticAssignment = options.allowAutomaticAssignment !== false;
    const persisted = await this.repository.loadPersistedDecision(bookingId);
    if (persisted?.source === "manual") return persisted;

    const target = await this.repository.loadTarget(bookingId);
    if (!target) {
      const decision = needsLegAssignmentDecision({
        bookingId,
        explanation: "Event dates or route location are incomplete; assign a leg manually.",
      });
      await this.repository.saveDecision(decision);
      return decision;
    }

    if (target.travelLegId && !persisted) {
      const decision: LegAssignmentDecision = {
        bookingId,
        assignedLegId: target.travelLegId,
        suggestedLegId: target.travelLegId,
        source: "manual",
        explanation: "Existing leg assignment preserved",
        warning: null,
        previousStopDriveMinutes: null,
        nextStopDriveMinutes: null,
        confidence: "high",
      };
      await this.repository.saveDecision(decision);
      return decision;
    }

    const contexts = await this.repository.loadCandidateContexts(bookingId);
    if (!contexts.length) {
      const decision = needsLegAssignmentDecision({
        bookingId,
        explanation: "No active leg has enough route information to make a safe assignment.",
      });
      await this.repository.saveDecision(decision);
      return decision;
    }

    const evaluated: EvaluatedCandidate[] = [];
    for (const context of contexts) {
      const feasibility = await evaluateLegFeasibility({
        target,
        previousStop: context.previousStop,
        nextStop: context.nextStop,
        estimator: this.estimator,
      });
      evaluated.push({
        ...context,
        feasibility,
        routeDriveMinutes: routeDriveMinutes(feasibility),
      });
    }

    const feasible = evaluated.filter((candidate) => candidate.feasibility.eligible);
    if (!feasible.length) {
      const decision = needsLegAssignmentDecision({
        bookingId,
        explanation: "No leg has a realistic travel/setup window for this event.",
      });
      await this.repository.saveDecision(decision);
      return decision;
    }

    const priorYear = feasible.filter((candidate) => candidate.priorYearMatch);
    if (priorYear.length === 1) {
      const candidate = priorYear[0]!;
      const decision: LegAssignmentDecision = {
        bookingId,
        assignedLegId: candidate.legId,
        suggestedLegId: candidate.legId,
        source: "prior_year",
        explanation: `Handled this event last year. ${routeExplanation(candidate)}`,
        warning: candidate.feasibility.warning,
        previousStopDriveMinutes: candidate.feasibility.previousDriveMinutes,
        nextStopDriveMinutes: candidate.feasibility.nextDriveMinutes,
        confidence: "high",
      };
      if (allowAutomaticAssignment) await this.repository.assignLeg(bookingId, candidate.legId);
      else decision.assignedLegId = null;
      await this.repository.saveDecision(decision);
      return decision;
    }

    if (priorYear.length > 1) {
      const decision = needsLegAssignmentDecision({
        bookingId,
        explanation: "More than one active leg has prior-year ownership evidence; choose the leg manually.",
      });
      await this.repository.saveDecision(decision);
      return decision;
    }

    const withRouteEvidence = feasible.filter((candidate) => candidate.routeDriveMinutes !== null);
    if (!withRouteEvidence.length) {
      const decision = needsLegAssignmentDecision({
        bookingId,
        explanation: "There is no surrounding confirmed route to base an automatic leg assignment on.",
      });
      await this.repository.saveDecision(decision);
      return decision;
    }

    withRouteEvidence.sort((a, b) =>
      a.confirmedEventCount - b.confirmedEventCount ||
      (a.routeDriveMinutes ?? Number.MAX_SAFE_INTEGER) - (b.routeDriveMinutes ?? Number.MAX_SAFE_INTEGER) ||
      a.legName.localeCompare(b.legName),
    );

    const best = withRouteEvidence[0]!;
    const second = withRouteEvidence[1] ?? null;
    const sameWorkload = second ? second.confirmedEventCount === best.confirmedEventCount : false;
    const routeDifference = second && best.routeDriveMinutes !== null && second.routeDriveMinutes !== null
      ? second.routeDriveMinutes - best.routeDriveMinutes
      : null;

    if (sameWorkload && routeDifference !== null && routeDifference < 60) {
      const decision = needsLegAssignmentDecision({
        bookingId,
        explanation: `${best.legName} and ${second!.legName} are nearly tied after workload and route fit; choose the leg manually.`,
        warning: best.feasibility.warning,
      });
      await this.repository.saveDecision(decision);
      return decision;
    }

    const confidence: LegAssignmentDecision["confidence"] =
      !second || best.confirmedEventCount < second.confirmedEventCount || (routeDifference ?? 0) >= 120
        ? "high"
        : "medium";
    const decision: LegAssignmentDecision = {
      bookingId,
      assignedLegId: allowAutomaticAssignment && confidence === "high" ? best.legId : null,
      suggestedLegId: best.legId,
      source: "route_score",
      explanation: `Balanced workload first, then route fit. ${routeExplanation(best)}`,
      warning: best.feasibility.warning,
      previousStopDriveMinutes: best.feasibility.previousDriveMinutes,
      nextStopDriveMinutes: best.feasibility.nextDriveMinutes,
      confidence,
    };
    if (decision.assignedLegId) await this.repository.assignLeg(bookingId, decision.assignedLegId);
    await this.repository.saveDecision(decision);
    return decision;
  }

  async suggest(bookingId: string): Promise<LegAssignmentDecision> {
    return this.evaluate(bookingId, { allowAutomaticAssignment: false });
  }

  async recordManualAssignment(bookingId: string, legId: string): Promise<LegAssignmentDecision> {
    await this.repository.assignLeg(bookingId, legId);
    const decision: LegAssignmentDecision = {
      bookingId,
      assignedLegId: legId,
      suggestedLegId: legId,
      source: "manual",
      explanation: "Assigned manually",
      warning: null,
      previousStopDriveMinutes: null,
      nextStopDriveMinutes: null,
      confidence: "high",
    };
    await this.repository.saveDecision(decision);
    return decision;
  }
}
