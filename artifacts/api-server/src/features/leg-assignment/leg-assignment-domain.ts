export type LegAssignmentWarning = "long_travel" | "major_travel_concern";

export type LegAssignmentSource =
  | "prior_year"
  | "route_score"
  | "manual"
  | "needs_review";

export type LegAssignmentConfidence = "high" | "medium" | "low";

export type LegAssignmentDecision = {
  bookingId: string;
  assignedLegId: string | null;
  suggestedLegId: string | null;
  source: LegAssignmentSource;
  explanation: string;
  warning: LegAssignmentWarning | null;
  previousStopDriveMinutes: number | null;
  nextStopDriveMinutes: number | null;
  confidence: LegAssignmentConfidence;
};

export function travelWarningForMinutes(minutes: number | null): LegAssignmentWarning | null {
  if (minutes === null) return null;
  if (minutes >= 12 * 60) return "major_travel_concern";
  if (minutes >= 8 * 60) return "long_travel";
  return null;
}

export function strongestTravelWarning(
  previousStopDriveMinutes: number | null,
  nextStopDriveMinutes: number | null,
): LegAssignmentWarning | null {
  const warnings = [
    travelWarningForMinutes(previousStopDriveMinutes),
    travelWarningForMinutes(nextStopDriveMinutes),
  ];
  if (warnings.includes("major_travel_concern")) return "major_travel_concern";
  if (warnings.includes("long_travel")) return "long_travel";
  return null;
}

export function needsLegAssignmentDecision(input: {
  bookingId: string;
  explanation: string;
  warning?: LegAssignmentWarning | null;
}): LegAssignmentDecision {
  return {
    bookingId: input.bookingId,
    assignedLegId: null,
    suggestedLegId: null,
    source: "needs_review",
    explanation: input.explanation,
    warning: input.warning ?? null,
    previousStopDriveMinutes: null,
    nextStopDriveMinutes: null,
    confidence: "low",
  };
}

export function manualLegAssignmentDecision(input: {
  bookingId: string;
  legId: string;
  explanation?: string;
}): LegAssignmentDecision {
  return {
    bookingId: input.bookingId,
    assignedLegId: input.legId,
    suggestedLegId: input.legId,
    source: "manual",
    explanation: input.explanation ?? "Assigned manually",
    warning: null,
    previousStopDriveMinutes: null,
    nextStopDriveMinutes: null,
    confidence: "high",
  };
}
