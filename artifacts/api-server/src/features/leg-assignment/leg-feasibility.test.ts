import { describe, expect, it } from "vitest";

import { evaluateLegFeasibility, type DriveTimeEstimator } from "./leg-feasibility";
import type { AssignmentTarget, RouteStop } from "./leg-assignment-repository";

const target: AssignmentTarget = {
  bookingId: "target",
  name: "Target Event",
  organizationId: null,
  status: "interested",
  travelLegId: null,
  latitude: 44,
  longitude: -105,
  startsAt: new Date("2026-09-10T12:00:00Z"),
  endsAt: new Date("2026-09-12T12:00:00Z"),
};

function previous(hoursBefore: number): RouteStop {
  return {
    bookingId: "previous",
    name: "Previous",
    latitude: 45,
    longitude: -106,
    startsAt: new Date(target.startsAt.getTime() - (hoursBefore + 24) * 3_600_000),
    endsAt: new Date(target.startsAt.getTime() - hoursBefore * 3_600_000),
  };
}

function estimator(minutes: number | null): DriveTimeEstimator {
  return { estimateMinutes: async () => minutes };
}

describe("evaluateLegFeasibility", () => {
  it("keeps 7h59 below the travel warning threshold", async () => {
    const result = await evaluateLegFeasibility({
      target,
      previousStop: previous(96),
      nextStop: null,
      estimator: estimator(7 * 60 + 59),
    });
    expect(result.eligible).toBe(true);
    expect(result.warning).toBeNull();
  });

  it("flags an 8 hour drive as long travel when the route has enough room", async () => {
    const result = await evaluateLegFeasibility({
      target,
      previousStop: previous(96),
      nextStop: null,
      estimator: estimator(8 * 60),
    });
    expect(result.eligible).toBe(true);
    expect(result.warning).toBe("long_travel");
  });

  it("flags 12 hours as a major travel concern", async () => {
    const result = await evaluateLegFeasibility({
      target,
      previousStop: previous(96),
      nextStop: null,
      estimator: estimator(12 * 60),
    });
    expect(result.eligible).toBe(true);
    expect(result.warning).toBe("major_travel_concern");
  });

  it("rejects the same 8 hour drive when there is only one day available", async () => {
    const result = await evaluateLegFeasibility({
      target,
      previousStop: previous(24),
      nextStop: null,
      estimator: estimator(8 * 60),
    });
    expect(result.eligible).toBe(false);
    expect(result.warning).toBe("long_travel");
  });

  it("does not guess when a surrounding stop cannot be routed", async () => {
    const result = await evaluateLegFeasibility({
      target,
      previousStop: previous(96),
      nextStop: null,
      estimator: estimator(null),
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/manual review/i);
  });
});
