import { describe, expect, it } from "vitest";
import { buildDailyWork } from "./daily-work";
import { emptyMasterTodayQueue, type MasterWorkItem } from "./master-work-types";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";

const now = new Date("2026-10-08T18:00:00Z");
const decision = { id: "booking", name: "Lead", status: "new_lead", organizationId: "org" };
const followUp: FollowUpSummary = {
  id: "reminder", organizationId: "org", bookingId: "booking", contactId: null,
  bookingName: "Lead", kind: "email", dueAt: new Date("2026-10-07T18:00:00Z"),
  createdAt: now, status: "due", probability: "possible",
};
const master: MasterWorkItem = {
  id: "follow_up:reminder", sourceId: "reminder", sourceType: "follow_up",
  opportunityId: "opp", organizationId: "org", bookingId: "booking", contactId: null,
  eventName: "Lead", city: "Denver", region: "CO", kind: "follow_up", reason: "Reply needed",
  dueAt: followUp.dueAt.toISOString(), opportunityStatus: "new", priority: "normal",
  pinned: false, manualOrder: null, completedAt: null, outcome: null,
};

describe("unified daily work", () => {
  it("represents a reminder once and attaches its lead decision and reminder actions", () => {
    const result = buildDailyWork({ ...emptyMasterTodayQueue, active: [master] }, [followUp], [decision], now);
    expect(result.open).toHaveLength(1);
    expect(result.open[0].followUp?.id).toBe("reminder");
    expect(result.open[0].decision?.id).toBe("booking");
  });
  it("keeps future work out of the active queue", () => {
    const result = buildDailyWork(emptyMasterTodayQueue, [{ ...followUp, dueAt: new Date("2026-10-15T18:00:00Z") }], [], now);
    expect(result.open).toHaveLength(0);
    expect(result.later).toHaveLength(1);
  });
  it("keeps lead intake usable when the master queue is empty", () => {
    const result = buildDailyWork(emptyMasterTodayQueue, [], [decision], now);
    expect(result.open).toHaveLength(1);
    expect(result.open[0].href).toContain("/profiles/org?");
    expect(result.open[0].href).toContain("mode=prospect");
  });
  it("keeps today's reminders active even when their time is later today", () => {
    const result = buildDailyWork({ ...emptyMasterTodayQueue, active: [{ ...master, dueAt: "2026-10-08T23:00:00Z" }] }, [], [], now);
    expect(result.open).toHaveLength(1);
    expect(result.later).toHaveLength(0);
  });
  it("does not hide a lead decision behind an unrelated waiting conversation", () => {
    const waiting = { ...master, id: "waiting", sourceType: "email_thread_attention", attentionState: "waiting_for_their_reply" as const, dueAt: null };
    const result = buildDailyWork({ ...emptyMasterTodayQueue, active: [waiting] }, [], [decision], now);
    expect(result.open[0].decision?.id).toBe("booking");
    expect(result.later).toHaveLength(1);
  });
  it("preserves server priority order instead of regrouping by kind", () => {
    const urgent = { ...master, id: "reply", sourceId: "thread", sourceType: "email_thread_attention", kind: "reply" as const, priority: "urgent" as const };
    const result = buildDailyWork({ ...emptyMasterTodayQueue, needsAttention: [urgent], active: [master] }, [], [], now);
    expect(result.open.map(item => item.id)).toEqual(["reply", "follow_up:reminder"]);
  });
});
