import { describe, expect, it } from "vitest";
import { applyTodaySeasonReset, TODAY_SEASON_RESET_AT } from "./today-season-reset";

function dashboard() {
  return {
    followUpCount: 3,
    newLeadCount: 4,
    contractCount: 1,
    visibleRouteWarningCount: 0,
    nextCall: { id: "old-call", bookingId: "old-lead", bookingName: "Old Lead", kind: "call", dueAt: new Date("2026-08-20T15:00:00Z"), createdAt: new Date("2026-07-01T15:00:00Z"), bookingStatus: "new_lead" },
    followUps: [
      { id: "old-call", bookingId: "old-lead", bookingName: "Old Lead", kind: "call", dueAt: new Date("2026-08-20T15:00:00Z"), createdAt: new Date("2026-07-01T15:00:00Z"), bookingStatus: "new_lead" },
      { id: "carried-call", bookingId: "carried-lead", bookingName: "Carried Lead", kind: "call", dueAt: new Date("2026-09-03T15:00:00Z"), createdAt: new Date("2026-07-01T15:00:00Z"), bookingStatus: "new_lead" },
      { id: "new-contract-followup", bookingId: "new-contract", bookingName: "New Contract", kind: "email", dueAt: new Date("2026-09-02T15:00:00Z"), createdAt: new Date("2026-09-01T15:00:00Z"), bookingStatus: "pending_contract" },
    ],
    followUpTotal: 3,
    followUpPage: 1,
    followUpPageCount: 1,
    needsFollowUpPlan: [
      { id: "old-lead", name: "Old Lead", status: "new_lead", probability: "possible", planReason: "needs_action", startsAt: new Date("2026-07-10T15:00:00Z"), createdAt: new Date("2026-06-01T15:00:00Z"), updatedAt: new Date("2026-08-10T15:00:00Z") },
      { id: "late-2026-lead", name: "Late 2026 Lead", status: "new_lead", probability: "possible", planReason: "needs_action", startsAt: new Date("2026-10-10T15:00:00Z"), createdAt: new Date("2026-06-10T15:00:00Z"), updatedAt: new Date("2026-08-15T15:00:00Z") },
      { id: "fresh-lead", name: "Fresh Lead", status: "new_lead", probability: "possible", planReason: "needs_action", startsAt: new Date("2027-06-10T15:00:00Z"), createdAt: new Date("2026-08-20T15:00:00Z"), updatedAt: new Date("2026-08-20T15:00:00Z") },
      { id: "carried-lead", name: "Carried Lead", status: "new_lead", probability: "possible", planReason: "needs_action", startsAt: new Date("2026-07-12T15:00:00Z"), createdAt: new Date("2026-06-01T15:00:00Z"), updatedAt: new Date("2026-08-10T15:00:00Z") },
    ],
    needsFollowUpPlanTotal: 4,
    needsFollowUpPlanPage: 1,
    needsFollowUpPlanPageCount: 1,
    upcomingEvents: [],
    renewals: [],
    renewalTotal: 0,
    renewalProminentCount: 0,
    renewalError: null,
  } as any;
}

describe("Today September 1 fresh booking plate", () => {
  it("does nothing before the September 1 cutover", () => {
    const input = dashboard();
    expect(applyTodaySeasonReset(input, new Date("2026-08-31T18:00:00Z"))).toBe(input);
  });

  it("removes stale 2026 booking work but keeps deliberate carry-forward and 2027 work", () => {
    const result = applyTodaySeasonReset(dashboard(), new Date("2026-09-02T18:00:00Z"));

    expect(TODAY_SEASON_RESET_AT.toISOString()).toContain("2026-09-01");
    expect(result.followUps.map((item: any) => item.id)).toEqual(["carried-call", "new-contract-followup"]);
    expect(result.needsFollowUpPlan.map((item: any) => item.id)).toEqual(["fresh-lead", "carried-lead"]);
    expect(result.needsFollowUpPlan.map((item: any) => item.id)).not.toContain("late-2026-lead");
    expect(result.nextCall?.id).toBe("carried-call");
    expect(result.followUpTotal).toBe(2);
    expect(result.needsFollowUpPlanTotal).toBe(2);
    expect(result.newLeadCount).toBe(2);
    expect(result.contractCount).toBe(1);
  });
});
