import { evaluateOutreach } from "./outreach-policy";
import { describe, expect, it } from "vitest";
import { applyPortfolioPriority } from "./outreach-portfolio";
import type { CandidateDTO, PlannerDTO } from "./outreach-dto";
import {
  projectReservations,
  verifyTravel,
  capacityDecision,
  type AllocationFacts,
  type AllocationTarget,
  type HoldFact,
} from "./outreach-capacity-evidence";
const now = new Date("2026-08-01T18:00:00Z");
function candidate(
  id: string,
  legId: string,
  startsOn = "2026-12-01",
  endsOn = "2026-12-04",
  resourceId = id,
): CandidateDTO {
  const target: AllocationTarget = {
    bookingId: id,
    eventStartsOn: startsOn,
    eventEndsOn: endsOn,
    startsOn,
    endsOn,
    legId,
    quantities: { zone: 1 },
    resourceIds: [resourceId],
    location: { latitude: 40, longitude: -80 },
    demandFingerprint: "facts",
  };
  return {
    id,
    openingId: id,
    organizationName: `Event ${id}`,
    tier: "strong",
    manualRank: 0,
    releasedAt: null,
    waitingForCandidateId: null,
    waitingFor: null,
    liveHoldId: null,
    decisionDueAt: null,
    meaningfulReplyAt: null,
    sources: { manualNextActions: [] },
    outreach: {
      state: "ready",
      reason: "Ready",
      dueAt: null,
      nextStage: "initial",
    },
    capacity: { status: "fits", reasons: [] },
    lastAllocationCheck: { target, freshness: "current" },
  } as unknown as CandidateDTO;
}
function planner(candidates: CandidateDTO[], capacity = 1) {
  const p = {
    candidates,
    openings: candidates.map((c) => ({ id: c.id, title: `Opening ${c.id}` })),
  } as PlannerDTO;
  const facts: AllocationFacts = {
    generation: 0,
    windows: [],
    selections: [],
    assignments: [],
    legs: [],
    mirrors: [],
    calendars: [],
    demands: [],
    bookings: [],
    holds: [],
    resources: candidates.map((c) => ({
      id: c.lastAllocationCheck!.target!.resourceIds[0],
      name: c.id,
      code: c.id,
      category: "equipment",
      status: "available",
      movable: true,
      normal_travel_leg_id: null,
      setup_minutes: 0,
      teardown_minutes: 0,
      minimum_transfer_minutes: 0,
    })),
    packages: [
      {
        id: "zone",
        code: "zone",
        normal_capacity: capacity,
        temporary_unavailable_quantity: 0,
        active: true,
      },
    ],
  };
  return { p, facts };
}
function heldStop(c: CandidateDTO): HoldFact {
  const t = c.lastAllocationCheck!.target!;
  return {
    id: `hold-${c.id}`,
    candidate_id: c.id,
    booking_id: t.bookingId,
    opportunity_id: c.id,
    leg_id: t.legId,
    event_starts_on: t.eventStartsOn,
    event_ends_on: t.eventEndsOn,
    starts_on: t.startsOn,
    ends_on: t.endsOn,
    quantities: t.quantities,
    resource_ids: t.resourceIds,
    location: t.location,
    demand_fingerprint: t.demandFingerprint,
    revision: 1,
    state: "active",
    owner: "owner",
    expires_at: "2026-08-10T18:00:00Z",
    ended_at: null,
  };
}
describe("portfolio pursuit contention", () => {
  it("gives only one first choice for two legs sharing one package and names the competitor", () => {
    const { p, facts } = planner([
      candidate("a", "leg1"),
      candidate("b", "leg2"),
    ]);
    applyPortfolioPriority(p, facts, now);
    expect(p.candidates.map((c) => c.portfolio.state)).toEqual([
      "first_choice",
      "waiting",
    ]);
    expect(p.candidates[1].portfolio.competing[0]).toMatchObject({
      candidateId: "a",
      organizationName: "Event a",
      openingTitle: "Opening a",
    });
  });
  it("does not greedily sum nonoverlapping quantities over a long competing window", () => {
    const { p, facts } = planner(
      [
        candidate("a", "leg1", "2026-12-01", "2026-12-02"),
        candidate("b", "leg2", "2026-12-03", "2026-12-04"),
        candidate("c", "leg3", "2026-12-01", "2026-12-04"),
      ],
      2,
    );
    applyPortfolioPriority(p, facts, now);
    expect(
      p.candidates.every((c) => c.portfolio.state === "first_choice"),
    ).toBe(true);
  });
  it("defers shared physical equipment and retains a competing callback visibly", () => {
    const a = candidate("a", "leg1", undefined, undefined, "equipment"),
      b = candidate("b", "leg2", undefined, undefined, "equipment");
    b.sources.manualNextActions = [
      { id: "callback", kind: "callback", dueAt: now.toISOString() },
    ];
    const { p, facts } = planner([a, b], 2);
    applyPortfolioPriority(p, facts, now);
    expect(b.portfolio.state).toBe("attention");
    expect(b.portfolio.competing).toHaveLength(1);
    expect(b.sources.manualNextActions).toHaveLength(1);
    expect(b.releasedAt).toBeNull();
    expect(facts.holds).toHaveLength(0);
  });
  it("keeps stale facts in review and does not pretend an unknown event is allocatable", () => {
    const c = candidate("a", "leg1");
    c.lastAllocationCheck!.freshness = "stale";
    const { p, facts } = planner([c]);
    applyPortfolioPriority(p, facts, now);
    expect(c.portfolio.state).toBe("needs_review");
  });
  it("counts a live held pursuit once, permitting the remaining package", () => {
    const a = candidate("a", "leg1"),
      b = candidate("b", "leg2");
    a.liveHoldId = "hold-a";
    const { p, facts } = planner([a, b], 2);
    const t = a.lastAllocationCheck!.target!;
    facts.holds = [
      {
        id: "hold-a",
        candidate_id: "a",
        booking_id: "a",
        opportunity_id: "a",
        leg_id: t.legId,
        event_starts_on: t.eventStartsOn,
        event_ends_on: t.eventEndsOn,
        starts_on: t.startsOn,
        ends_on: t.endsOn,
        quantities: t.quantities,
        resource_ids: t.resourceIds,
        location: t.location,
        demand_fingerprint: "facts",
        revision: 1,
        state: "active",
        owner: "owner",
        expires_at: "2026-08-10T18:00:00Z",
        ended_at: null,
      },
    ];
    applyPortfolioPriority(p, facts, now);
    expect(p.candidates.map((c) => c.portfolio.state)).toEqual([
      "first_choice",
      "first_choice",
    ]);
  });
  it.each(["leg", "resource", "both"] as const)(
    "requires named travel review for adjacent remote pursuits sharing %s, regardless of priority order",
    (shared) => {
      for (const reverse of [false, true]) {
        const a = candidate(
          "a",
          "leg1",
          "2026-12-01",
          "2026-12-02",
          "equipment-a",
        );
        const b = candidate(
          "b",
          shared === "resource" ? "leg2" : "leg1",
          "2026-12-03",
          "2026-12-04",
          shared === "leg" ? "equipment-b" : "equipment-a",
        );
        a.lastAllocationCheck!.target!.location = {
          latitude: 40.7128,
          longitude: -74.006,
        };
        b.lastAllocationCheck!.target!.location = {
          latitude: 34.0522,
          longitude: -118.2437,
        };
        if (reverse) a.manualRank = 1;
        const { p, facts } = planner([a, b]);
        applyPortfolioPriority(p, facts, now);
        const leader = reverse ? b : a,
          follower = reverse ? a : b;
        expect(leader.portfolio.state).toBe("first_choice");
        expect(follower.portfolio).toMatchObject({
          state: "needs_review",
          competing: [
            {
              candidateId: leader.id,
              organizationName: leader.organizationName,
              openingTitle: `Opening ${leader.id}`,
            },
          ],
        });
        expect(follower.portfolio.reason).toContain(
          "Shared-route travel needs review",
        );
      }
    },
  );
  it("preserves a remote adjacent callback visibly while its combined route is unverified", () => {
    const a = candidate("a", "leg1", "2026-12-01", "2026-12-02", "equipment");
    const b = candidate("b", "leg2", "2026-12-03", "2026-12-04", "equipment");
    b.sources.manualNextActions = [
      { id: "callback", kind: "callback", dueAt: now.toISOString() },
    ];
    const { p, facts } = planner([a, b]);
    applyPortfolioPriority(p, facts, now);
    expect(b.portfolio.state).toBe("attention");
    expect(b.portfolio.competing[0].candidateId).toBe(a.id);
    expect(b.sources.manualNextActions).toHaveLength(1);
    expect(b.releasedAt).toBeNull();
  });
  it("retains feasible independently verified transfers through established adjacent stops", async () => {
    const a = candidate("a", "leg1", "2026-12-01", "2026-12-02", "equipment");
    const b = candidate("b", "leg1", "2026-12-12", "2026-12-13", "equipment");
    const { p, facts } = planner([a, b]);
    facts.holds = [
      heldStop(
        candidate("before", "leg1", "2026-11-20", "2026-11-21", "equipment"),
      ),
      heldStop(
        candidate("between", "leg1", "2026-12-06", "2026-12-07", "equipment"),
      ),
      heldStop(
        candidate("after", "leg1", "2026-12-20", "2026-12-21", "equipment"),
      ),
    ];
    // Each prospective event is independently checked against the same actual
    // intervening held stop. No previously unseen A-to-B transfer is assumed.
    for (const c of [a, b]) {
      const target = c.lastAllocationCheck!.target!;
      const projection = projectReservations(facts, target, now);
      const reasons = await verifyTravel(
        facts,
        target,
        projection,
        { estimateMinutes: async () => 120 },
        now,
      );
      expect(reasons).toEqual([]);
      c.capacity = capacityDecision(target, projection, reasons);
      expect(c.capacity.status).toBe("fits");
    }
    applyPortfolioPriority(p, facts, now);
    expect([a.portfolio.state, b.portfolio.state]).toEqual([
      "first_choice",
      "first_choice",
    ]);
  });
  it("retains a feasible independently verified transfer from a selected held event", async () => {
    const a = candidate("a", "leg1", "2026-12-01", "2026-12-02", "equipment");
    const b = candidate("b", "leg1", "2026-12-08", "2026-12-09", "equipment");
    a.liveHoldId = "hold-a";
    const { p, facts } = planner([a, b]);
    facts.holds = [
      heldStop(a),
      heldStop(
        candidate("after", "leg1", "2026-12-20", "2026-12-21", "equipment"),
      ),
    ];
    const target = b.lastAllocationCheck!.target!,
      projection = projectReservations(facts, target, now);
    const reasons = await verifyTravel(
      facts,
      target,
      projection,
      { estimateMinutes: async () => 120 },
      now,
    );
    expect(reasons).toEqual([]);
    b.capacity = capacityDecision(target, projection, reasons);
    applyPortfolioPriority(p, facts, now);
    expect([a.portfolio.state, b.portfolio.state]).toEqual([
      "first_choice",
      "first_choice",
    ]);
  });
});

describe("final review ongoing pursuit contract", () => {
  it.each([1, 2])(
    "retains a contacted pursuit through waiting after %s actual stages until explicit release",
    (count) => {
      const a = candidate("a", "leg1"),
        b = candidate("b", "leg2");
      a.tier = "convention";
      b.tier = "filler";
      a.attempts = [
        {
          id: "initial",
          sourceId: "initial",
          stage: "initial",
          occurredAt: "2026-07-01T18:00:00Z",
        },
        ...(count === 2
          ? [
              {
                id: "followup",
                sourceId: "followup",
                stage: "follow_up_1",
                occurredAt: "2026-07-31T18:00:00Z",
              },
            ]
          : []),
      ] as CandidateDTO["attempts"];
      if (count === 1) a.attempts[0].occurredAt = "2026-07-31T18:00:00Z";
      a.outreach = evaluateOutreach(
        {
          tier: a.tier,
          status: "ready_to_contact",
          attempts: a.attempts.map((x) => ({ ...x, successful: true })),
          meaningfulReplyAt: null,
          decisionDueAt: null,
          conventionEndsOn: "2026-06-20",
          operationalStartsOn: "2026-12-01",
          blockedReason: null,
        },
        now,
      );
      const { p, facts } = planner([a, b]);
      applyPortfolioPriority(p, facts, now);
      expect(a.outreach.state).toBe("waiting");
      expect(a.portfolio.state).toBe("waiting");
      expect(b.portfolio).toMatchObject({
        state: "waiting",
        competing: [{ candidateId: "a" }],
      });
      a.releasedAt = now.toISOString();
      a.outreach.state = "closed";
      applyPortfolioPriority(p, facts, now);
      expect(b.portfolio.state).toBe("first_choice");
    },
  );
  it("returns an actionable real completed day-15 DTO", () => {
    const a = candidate("a", "leg1");
    a.outreach = evaluateOutreach(
      {
        tier: "strong",
        status: "ready_to_contact",
        attempts: ["initial", "follow_up_1", "follow_up_2"].map((stage, i) => ({
          id: stage,
          stage,
          occurredAt: `2026-07-${String([1, 4, 11][i]).padStart(2, "0")}T18:00:00Z`,
          successful: true,
        })) as any,
        meaningfulReplyAt: null,
        decisionDueAt: null,
        conventionEndsOn: null,
        operationalStartsOn: "2026-12-01",
        blockedReason: null,
      },
      now,
    );
    const { p, facts } = planner([a]);
    applyPortfolioPriority(p, facts, now);
    expect(a.outreach.state).toBe("advance");
    expect(a.portfolio.state).toBe("first_choice");
  });
});
