import { describe, expect, it } from "vitest";

import { businessDayBounds } from "@/lib/business-date";
import {
  applyEmailFailureAttention,
  applyEmailFailuresToCandidates,
  buildMasterTodayQueue,
  type MasterWorkCandidate,
  type MasterWorkItem,
} from "./master-work-queue";

const NOW = new Date("2026-08-26T17:00:00.000Z");
const DUE = new Date("2026-08-26T14:00:00.000Z");
const FUTURE = new Date("2026-08-29T14:00:00.000Z");

function workItem(
  id: string,
  overrides: Partial<MasterWorkCandidate> = {},
): MasterWorkCandidate {
  return {
    id,
    sourceId: id,
    sourceType: "opportunity",
    opportunityId: `10000000-0000-4000-8000-${id.padStart(12, "0")}`,
    organizationId: "20000000-0000-4000-8000-000000000001",
    bookingId: null,
    contactId: null,
    eventName: `Event ${id}`,
    city: "Sample City",
    region: "CO",
    kind: "cleanup",
    reason: "Clean up profile",
    dueAt: null,
    opportunityStatus: "contacted",
    priority: "normal",
    pinned: false,
    manualOrder: null,
    completedAt: null,
    snoozedUntil: null,
    ...overrides,
  };
}

function ids(items: MasterWorkItem[]): string[] {
  return items.map((item) => item.id);
}

describe("buildMasterTodayQueue", () => {
  it("uses the approved smart priority and section order", () => {
    const queue = buildMasterTodayQueue(
      [
        workItem("cleanup"),
        workItem("new", { kind: "new_outreach" }),
        workItem("research", { kind: "research" }),
        workItem("review", { kind: "review" }),
        workItem("draft", { kind: "draft" }),
        workItem("follow-up", { kind: "follow_up", dueAt: DUE }),
        workItem("hot", { kind: "booking", opportunityStatus: "interested" }),
        workItem("callback", { kind: "callback", dueAt: DUE }),
        workItem("reply", { kind: "reply", dueAt: FUTURE }),
      ],
      NOW,
    );

    expect(ids(queue.needsAttention)).toEqual(["reply", "callback", "hot", "review"]);
    expect(ids(queue.active)).toEqual([
      "follow-up",
      "draft",
      "research",
      "new",
      "cleanup",
    ]);
    expect(queue.completedToday).toEqual([]);
  });

  it("turns a failed email into review work without creating a second work item", () => {
    const candidate = applyEmailFailureAttention(
      workItem("draft", { kind: "draft", reason: "Ready to Send" }),
      "Gmail temporarily unavailable",
    );
    const queue = buildMasterTodayQueue([candidate], NOW);

    expect(queue.needsAttention).toHaveLength(1);
    expect(queue.needsAttention[0]).toMatchObject({
      id: "draft",
      kind: "review",
      reason: "Email delivery failed: Gmail temporarily unavailable",
    });
    expect(queue.active).toEqual([]);
  });

  it("maps failed-email messages onto only the matching Opportunity candidates", () => {
    const failed = workItem("1", { kind: "draft", reason: "Ready to Send" });
    const healthy = workItem("2", { kind: "draft", reason: "Ready to Send" });
    const mapped = applyEmailFailuresToCandidates(
      [failed, healthy],
      new Map([[failed.opportunityId!, "Gmail 503"]]),
    );

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({
      id: failed.id,
      kind: "review",
      reason: "Email delivery failed: Gmail 503",
    });
    expect(mapped[1]).toEqual(healthy);
  });

  it("places pinned items before smart order and uses manual order among peers", () => {
    const queue = buildMasterTodayQueue(
      [
        workItem("smart", { kind: "follow_up", dueAt: DUE }),
        workItem("manual-two", {
          kind: "cleanup",
          pinned: true,
          manualOrder: 2,
        }),
        workItem("manual-zero", {
          kind: "cleanup",
          pinned: true,
          manualOrder: 0,
        }),
        workItem("pinned-smart", {
          kind: "cleanup",
          pinned: true,
          manualOrder: null,
        }),
      ],
      NOW,
    );

    expect(ids(queue.active)).toEqual([
      "manual-zero",
      "manual-two",
      "pinned-smart",
      "smart",
    ]);
  });

  it("hides snoozed work until its snooze instant is due", () => {
    const queue = buildMasterTodayQueue(
      [
        workItem("hidden", {
          kind: "follow_up",
          snoozedUntil: new Date(NOW.getTime() + 60_000),
        }),
        workItem("visible", {
          kind: "follow_up",
          snoozedUntil: new Date(NOW),
        }),
      ],
      NOW,
    );

    expect(ids(queue.active)).toEqual(["visible"]);
  });

  it("keeps only completions inside today's Chicago business-day bounds", () => {
    const { start, end } = businessDayBounds(NOW);
    const queue = buildMasterTodayQueue(
      [
        workItem("start", { completedAt: start }),
        workItem("inside", {
          completedAt: new Date(end.getTime() - 1),
        }),
        workItem("yesterday", {
          completedAt: new Date(start.getTime() - 1),
        }),
        workItem("tomorrow", { completedAt: end }),
      ],
      NOW,
    );

    expect(ids(queue.completedToday)).toEqual(["inside", "start"]);
    expect(queue.active).toEqual([]);
    expect(queue.needsAttention).toEqual([]);
  });
});
it("keeps both conversation states visible and deduplicates only exact thread identity",()=>{
 const reply=workItem("reply",{kind:"reply",gmailConnectionId:"account",threadId:"one"});
 const own=workItem("own",{sourceType:"email_thread_attention",kind:"reply",attentionState:"needs_your_reply",gmailConnectionId:"account",threadId:"one"});
 const waiting=workItem("waiting",{sourceType:"email_thread_attention",kind:"follow_up",attentionState:"waiting_for_their_reply",gmailConnectionId:"account",threadId:"two",dueAt:FUTURE});
 const other=workItem("other",{kind:"reply",gmailConnectionId:"other-account",threadId:"one"});
 const q=buildMasterTodayQueue([waiting,reply,own,other],NOW);
 expect(ids(q.needsAttention)).toEqual(["own","other","waiting"]);
 expect(q.active).toEqual([]);
});
