import { describe, expect, it } from "vitest";

import {
  manualLegAssignmentDecision,
  needsLegAssignmentDecision,
  strongestTravelWarning,
  travelWarningForMinutes,
} from "./leg-assignment-domain";

describe("leg assignment domain", () => {
  it("uses the approved 8 hour and 12 hour travel warning thresholds", () => {
    expect(travelWarningForMinutes(7 * 60 + 59)).toBeNull();
    expect(travelWarningForMinutes(8 * 60)).toBe("long_travel");
    expect(travelWarningForMinutes(11 * 60 + 59)).toBe("long_travel");
    expect(travelWarningForMinutes(12 * 60)).toBe("major_travel_concern");
    expect(strongestTravelWarning(8 * 60, 12 * 60)).toBe("major_travel_concern");
  });

  it("represents an ambiguous result as needs review without assigning a leg", () => {
    expect(needsLegAssignmentDecision({
      bookingId: "booking-1",
      explanation: "Two legs are effectively tied",
    })).toEqual({
      bookingId: "booking-1",
      assignedLegId: null,
      suggestedLegId: null,
      source: "needs_review",
      explanation: "Two legs are effectively tied",
      warning: null,
      previousStopDriveMinutes: null,
      nextStopDriveMinutes: null,
      confidence: "low",
    });
  });

  it("marks a manual leg assignment as authoritative and high confidence", () => {
    const decision = manualLegAssignmentDecision({ bookingId: "booking-2", legId: "leg-hulk" });
    expect(decision.source).toBe("manual");
    expect(decision.assignedLegId).toBe("leg-hulk");
    expect(decision.suggestedLegId).toBe("leg-hulk");
    expect(decision.confidence).toBe("high");
  });
});
