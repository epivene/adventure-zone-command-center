import { describe, expect, it } from "vitest";
import type { Candidate, Planner } from "@/features/outreach-planner/outreach-api";
import { buildLegCallList, legCallWorkspaceHref, type CallListFollowUp } from "./leg-call-list";

const now = new Date("2026-10-02T17:00:00Z");
export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "candidate-1", openingId: "opening-1", opportunityId: "event-1", organizationId: "org-1",
    bookingId: "booking-1", organizationName: "County Fair", eventYear: 2027,
    tier: "strong", manualRank: 0, releasedAt: null, snoozedUntil: null,
    waitingFor: null, outreach: { state: "follow_up", dueAt: "2026-10-01T17:00:00Z", reason: "Email follow-up is due.", nextStage: "follow_up_1" },
    portfolio: { state: "first_choice", reason: "First choice for this opening.", competing: [] },
    sources: { checkedAt: now.toISOString(), choices: [{ id: "email-1", kind: "sent_email", occurredAt: "2026-09-20T17:00:00Z", eligible: true, reason: "Matched event" }], reviewReasons: [], protectedReason: null, manualNextActions: [], historyFingerprint: "history" },
    capacity: { status: "needs_review", reasons: ["Crew missing"] }, capacityDisplayReasons: ["Crew missing"],
    ...overrides,
  } as Candidate;
}
export function planner(candidates = [candidate()]): Planner {
  return {
    enabled: true, candidates,
    openings: [
      { id: "opening-1", title: "Dave spring gap", status: "open", eventYear: 2027, startsOn: "2027-04-01", endsOn: "2027-04-10", legId: "dave", quantities: { az: 1 }, createdAt: now.toISOString() },
      { id: "opening-2", title: "Kristy spring gap", status: "open", eventYear: 2027, startsOn: "2027-04-01", endsOn: "2027-04-10", legId: "kristy", quantities: { az: 1 }, createdAt: now.toISOString() },
    ],
    legs: [{ id: "dave", name: "Dave", active: true }, { id: "kristy", name: "Kristy", active: true }],
    packages: [{ id: "az", code: "AZ", name: "Adventure Zone", active: true, normalCapacity: 5, temporaryUnavailableQuantity: 0 }], researchTasks: [],
  };
}
export function callback(overrides: Partial<CallListFollowUp> = {}): CallListFollowUp {
  return { id: "call-1", organizationId: "org-1", contactId: "contact-1", bookingId: "booking-1", bookingName: "County Fair callback", kind: "callback", dueAt: "2026-10-01T17:00:00Z", routeLeg: { id: "dave", name: "Dave" }, ...overrides };
}
describe("leg call list", () => {
  it("ranks requested callbacks first and labels proposed packages and unverified availability", () => {
    const rows = buildLegCallList([callback({ bookingId: "another-event" })], planner(), now);
    expect(rows.map((row) => row.followUpId)).toEqual(["call-1", null]);
    expect(rows[1].packages).toEqual(["Adventure Zone × 1"]);
    expect(rows[1].reason).toContain("Availability needs review: Crew missing");
    expect(rows[0].season).toBeNull();
    expect(rows[1].questions.join(" ")).toContain("2027");
  });
  it("preserves tier priority even with a large manual rank", () => {
    const dedicated = candidate({ opportunityId: "dedicated-event", tier: "dedicated", manualRank: 1000000 });
    const rows = buildLegCallList([], planner([candidate(), dedicated]), now);
    expect(rows[0].id).toContain("dedicated-event");
  });
  it("does not turn email checks, internal reviews or future callbacks into calls", () => {
    const reminders = [callback({ kind: "Check for reply" }), callback({ kind: "Review leg plan" }), callback({ kind: "Call list review" }), callback({ dueAt: "2026-10-04T17:00:00Z" })];
    expect(buildLegCallList(reminders, null, now)).toEqual([]);
  });
  it("retains cold prospects and protected records as review rows without a call action", () => {
    const cold = candidate({ outreach: { state: "ready", dueAt: null, reason: "Initial email", nextStage: "initial" } });
    expect(buildLegCallList([], planner([cold]), now)[0].reviewReason).toContain("initial email");
    const blocked = candidate();
    blocked.sources.protectedReason = "Last Resort";
    expect(buildLegCallList([], planner([blocked]), now)[0].reviewReason).toBe("Last Resort");
  });
  it("suppresses a linked prospect when its exact booking has a scheduled callback", () => {
    const item = candidate();
    item.sources.manualNextActions = [{ id: "call-1", kind: "callback", dueAt: "2026-10-04T17:00:00Z" }];
    expect(buildLegCallList([callback({ dueAt: "2026-10-04T17:00:00Z" })], planner([item]), now)).toEqual([]);
    // Same profile, different event: keep its prospect.
    expect(buildLegCallList([callback({ bookingId: "other-booking", dueAt: "2026-10-04T17:00:00Z" })], planner([item]), now)).toHaveLength(1);
  });
  it("requires review for a scheduled call missing from the loaded reminder page", () => {
    const item = candidate();
    item.sources.manualNextActions = [{ id: "not-loaded", kind: "callback", dueAt: "2026-10-04T17:00:00Z" }];
    expect(buildLegCallList([], planner([item]), now)[0].reviewReason).toContain("scheduled call");
  });
  it("deduplicates alternate openings for an event while preserving different event identities", () => {
    const items = [candidate(), candidate({ id: "candidate-2", openingId: "opening-2" }), candidate({ id: "candidate-3", opportunityId: "event-2", bookingId: "booking-2" })];
    expect(buildLegCallList([], planner(items), now)).toHaveLength(2);
    expect(buildLegCallList([], planner(items), now)[0].openingLabels).toHaveLength(2);
    const filtered = buildLegCallList([], planner(items), now, { season: "2027", legId: "kristy" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].legId).toBe("kristy");
  });
  it("keeps uncertain callback seasons visible and does not infer seasons from callback due dates", () => {
    const rows = buildLegCallList([callback({ bookingId: null })], planner(), now, { season: "2027", legId: "all" });
    expect(rows[0].season).toBeNull();
    expect(buildLegCallList([], planner(), now, { season: "2026", legId: "all" })).toEqual([]);
  });
  it("excludes filled gaps, snoozed, waiting and released candidates", () => {
    for (const changes of [{ releasedAt: now.toISOString() }, { snoozedUntil: "2026-10-04T17:00:00Z" }, { outreach: { state: "waiting", dueAt: null, reason: "Wait", nextStage: null } }] as Partial<Candidate>[]) {
      expect(buildLegCallList([], planner([candidate(changes)]), now)).toEqual([]);
    }
    const filled = planner(); filled.openings[0].status = "filled";
    expect(buildLegCallList([], filled, now)).toEqual([]);
  });
  it("requires a real earlier email and omits future contact sources from last contact", () => {
    const item = candidate();
    item.sources.choices[0].occurredAt = "2027-01-01T17:00:00Z";
    const row = buildLegCallList([], planner([item]), now)[0];
    expect(row.lastContactAt).toBeNull();
    expect(row.reviewReason).toContain("initial email");
  });
  it("opens the existing call workspace with event context and only real follow-up ids", () => {
    const row = buildLegCallList([], planner(), now)[0];
    expect(legCallWorkspaceHref(row)).toBe("/calls/workspace?organizationId=org-1&bookingId=booking-1");
    expect(legCallWorkspaceHref(buildLegCallList([callback()], null, now)[0])).toContain("followUpId=call-1");
  });
});
