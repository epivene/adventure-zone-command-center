import { describe, expect, it } from "vitest";

import type { LegAssignmentDecision } from "./leg-assignment-domain";
import { LegAssignmentService } from "./leg-assignment-service";
import type {
  AssignmentCandidateContext,
  AssignmentTarget,
  LegAssignmentStore,
  RouteStop,
} from "./leg-assignment-repository";

const target: AssignmentTarget = {
  bookingId: "booking",
  name: "Target Event",
  organizationId: "org",
  status: "interested",
  travelLegId: null,
  latitude: 44,
  longitude: -105,
  startsAt: new Date("2026-09-10T12:00:00Z"),
  endsAt: new Date("2026-09-12T12:00:00Z"),
};

function stop(id: string, before = true): RouteStop {
  return {
    bookingId: id,
    name: id,
    latitude: before ? 45 : 43,
    longitude: before ? -106 : -104,
    startsAt: new Date(before ? "2026-09-05T12:00:00Z" : "2026-09-17T12:00:00Z"),
    endsAt: new Date(before ? "2026-09-06T12:00:00Z" : "2026-09-18T12:00:00Z"),
  };
}

function candidate(overrides: Partial<AssignmentCandidateContext>): AssignmentCandidateContext {
  return {
    legId: "leg-kristy",
    legName: "Kristy",
    priorYearMatch: false,
    confirmedEventCount: 4,
    previousStop: stop("previous"),
    nextStop: null,
    ...overrides,
  };
}

function store(input: {
  target?: AssignmentTarget | null;
  contexts?: AssignmentCandidateContext[];
  persisted?: LegAssignmentDecision | null;
}) {
  const saved: LegAssignmentDecision[] = [];
  const assigned: Array<{ bookingId: string; legId: string }> = [];
  const fake: LegAssignmentStore = {
    loadTarget: async () => input.target === undefined ? target : input.target,
    loadCandidateContexts: async () => input.contexts ?? [],
    loadPersistedDecision: async () => input.persisted ?? null,
    saveDecision: async (decision) => { saved.push(decision); },
    assignLeg: async (bookingId, legId) => { assigned.push({ bookingId, legId }); },
  };
  return { fake, saved, assigned };
}

const estimator = (minutesByLatitude: Record<number, number | null>) => ({
  estimateMinutes: async (from: { latitude: number }, to: { latitude: number }) =>
    minutesByLatitude[from.latitude] ?? minutesByLatitude[to.latitude] ?? 120,
});

describe("LegAssignmentService", () => {
  it("gives a feasible prior-year leg first priority", async () => {
    const repo = store({ contexts: [
      candidate({ legId: "leg-kristy", legName: "Kristy", priorYearMatch: true, confirmedEventCount: 8 }),
      candidate({ legId: "leg-hulk", legName: "Hulk", confirmedEventCount: 1 }),
    ] });
    const decision = await new LegAssignmentService(repo.fake, estimator({ 45: 120 })).evaluate("booking");
    expect(decision.source).toBe("prior_year");
    expect(decision.assignedLegId).toBe("leg-kristy");
    expect(repo.assigned).toEqual([{ bookingId: "booking", legId: "leg-kristy" }]);
  });

  it("balances workload before route distance", async () => {
    const repo = store({ contexts: [
      candidate({ legId: "leg-kristy", legName: "Kristy", confirmedEventCount: 7, previousStop: { ...stop("k"), latitude: 46 } }),
      candidate({ legId: "leg-hulk", legName: "Hulk", confirmedEventCount: 2, previousStop: { ...stop("h"), latitude: 45 } }),
    ] });
    const decision = await new LegAssignmentService(repo.fake, estimator({ 46: 30, 45: 240 })).evaluate("booking");
    expect(decision.assignedLegId).toBe("leg-hulk");
    expect(decision.explanation).toMatch(/Balanced workload first/);
  });

  it("uses route fit when workloads tie", async () => {
    const repo = store({ contexts: [
      candidate({ legId: "leg-kristy", legName: "Kristy", confirmedEventCount: 3, previousStop: { ...stop("k"), latitude: 46 } }),
      candidate({ legId: "leg-hulk", legName: "Hulk", confirmedEventCount: 3, previousStop: { ...stop("h"), latitude: 45 } }),
    ] });
    const decision = await new LegAssignmentService(repo.fake, estimator({ 46: 300, 45: 120 })).evaluate("booking");
    expect(decision.assignedLegId).toBe("leg-hulk");
  });

  it("compares every active leg, including workload and infeasible route reasons, without changing assignments", async () => {
    const repo = store({ contexts: [
      candidate({
        legId: "leg-kristy",
        legName: "Kristy",
        priorYearMatch: true,
        confirmedEventCount: 2,
        previousStop: { ...stop("kristy"), latitude: 46 },
      }),
      candidate({
        legId: "leg-hulk",
        legName: "Hulk",
        confirmedEventCount: 7,
        previousStop: {
          ...stop("hulk"),
          latitude: 45,
          startsAt: new Date("2026-09-09T10:00:00Z"),
          endsAt: new Date("2026-09-10T11:00:00Z"),
        },
      }),
      candidate({
        legId: "leg-unplanned",
        legName: "Unplanned route",
        confirmedEventCount: 0,
        previousStop: null,
        nextStop: null,
      }),
    ] });

    const alternatives = await new LegAssignmentService(repo.fake, estimator({ 46: 60, 45: 180 })).compareAlternatives("booking");

    expect(alternatives).toHaveLength(3);
    expect(alternatives[0]).toMatchObject({
      legId: "leg-kristy",
      confirmedEventCount: 2,
      priorYearMatch: true,
      eligible: true,
      previousStopDriveMinutes: 60,
      routeDriveMinutes: 60,
      reason: "The confirmed route leaves enough travel and setup time.",
    });
    expect(alternatives[1]).toMatchObject({
      legId: "leg-hulk",
      confirmedEventCount: 7,
      eligible: false,
      previousStopDriveMinutes: 180,
      reason: "Not enough time between the previous confirmed stop and this event for travel and setup.",
    });
    expect(alternatives[2]).toMatchObject({
      legId: "leg-unplanned",
      eligible: false,
      routeDriveMinutes: null,
      reason: "No surrounding confirmed stops; travel and setup fit cannot be compared.",
    });
    expect(repo.saved).toHaveLength(0);
    expect(repo.assigned).toHaveLength(0);
  });

  it("returns needs review when route scores are effectively tied", async () => {
    const repo = store({ contexts: [
      candidate({ legId: "leg-kristy", legName: "Kristy", confirmedEventCount: 3, previousStop: { ...stop("k"), latitude: 46 } }),
      candidate({ legId: "leg-hulk", legName: "Hulk", confirmedEventCount: 3, previousStop: { ...stop("h"), latitude: 45 } }),
    ] });
    const decision = await new LegAssignmentService(repo.fake, estimator({ 46: 180, 45: 150 })).evaluate("booking");
    expect(decision.source).toBe("needs_review");
    expect(decision.assignedLegId).toBeNull();
  });

  it("preserves an existing manual assignment", async () => {
    const manual: LegAssignmentDecision = {
      bookingId: "booking",
      assignedLegId: "leg-hulk",
      suggestedLegId: "leg-hulk",
      source: "manual",
      explanation: "Assigned manually",
      warning: null,
      previousStopDriveMinutes: null,
      nextStopDriveMinutes: null,
      confidence: "high",
    };
    const repo = store({ target: { ...target, travelLegId: "leg-hulk" }, persisted: manual });
    const decision = await new LegAssignmentService(repo.fake, estimator({})).evaluate("booking");
    expect(decision).toEqual(manual);
    expect(repo.assigned).toHaveLength(0);
    expect(repo.saved).toHaveLength(0);
  });

  it("preserves the manual decision when event details become incomplete", async () => {
    const manual: LegAssignmentDecision = {
      bookingId: "booking",
      assignedLegId: "leg-hulk",
      suggestedLegId: "leg-hulk",
      source: "manual",
      explanation: "Assigned manually",
      warning: null,
      previousStopDriveMinutes: null,
      nextStopDriveMinutes: null,
      confidence: "high",
    };
    const repo = store({ target: null, persisted: manual });

    const decision = await new LegAssignmentService(repo.fake, estimator({})).evaluate("booking");

    expect(decision).toEqual(manual);
    expect(repo.assigned).toHaveLength(0);
    expect(repo.saved).toHaveLength(0);
  });

  it("refreshes an existing automatic assignment from updated route evidence", async () => {
    const previousAutomatic: LegAssignmentDecision = {
      bookingId: "booking",
      assignedLegId: "leg-kristy",
      suggestedLegId: "leg-kristy",
      source: "route_score",
      explanation: "Previous route suggestion",
      warning: null,
      previousStopDriveMinutes: 240,
      nextStopDriveMinutes: null,
      confidence: "high",
    };
    const repo = store({
      target: { ...target, travelLegId: "leg-kristy" },
      persisted: previousAutomatic,
      contexts: [
        candidate({
          legId: "leg-hulk",
          legName: "Hulk",
          previousStop: { ...stop("hulk"), latitude: 45 },
        }),
      ],
    });

    const decision = await new LegAssignmentService(repo.fake, estimator({ 45: 60 })).evaluate("booking");

    expect(decision.source).toBe("route_score");
    expect(decision.assignedLegId).toBe("leg-hulk");
    expect(repo.assigned).toEqual([{ bookingId: "booking", legId: "leg-hulk" }]);
    expect(repo.saved).toEqual([decision]);
  });
});
