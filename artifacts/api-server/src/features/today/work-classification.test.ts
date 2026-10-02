import { expect, it } from "vitest";
import { kindFor, reasonFor } from "./work-classification";
import {
  buildMasterTodayQueue,
  type MasterWorkCandidate,
} from "./master-work-queue";
import { decisionReview } from "../chatgpt-connection/decision-review";
import { attachVerifiedAttentionIdentity } from "./thread-attention-identity";

const now = new Date("2026-10-02T03:00:00Z");
function reminder(
  text: string,
  dueAt = new Date("2026-10-08T16:00:00Z"),
): MasterWorkCandidate {
  return {
    id: "reminder",
    sourceId: "reminder",
    sourceType: "follow_up",
    organizationId: "profile",
    opportunityId: null,
    bookingId: null,
    contactId: null,
    eventName: "Fair",
    city: null,
    region: null,
    kind: kindFor(text, "ready_to_contact", true),
    reason: reasonFor(kindFor(text, null, true), false, text),
    dueAt,
    opportunityStatus: null,
    priority: "normal",
    pinned: false,
    manualOrder: null,
    completedAt: null,
    snoozedUntil: null,
  };
}

it.each([
  "2027 outreach: check for a reply to the October 1 email; review next step if unanswered",
  "Verify authorized October 2 8 a.m. Mountain follow-up send; if sent check for reply and set post-send reminder; if unsent review existing draft",
  "Review existing draft if no response; do not send",
])(
  "keeps real free-text reminders out of new-reply and ready-draft categories: %s",
  (text) => {
    const row = reminder(text);
    expect(row.kind).toBe("follow_up");
    expect(row.reason).toBe(text);
    const queue = buildMasterTodayQueue([row], now);
    expect(queue.needsAttention).toEqual([]);
    expect(queue.active).toHaveLength(1);
    expect(decisionReview(row, now)).toBeNull();
    row.dueAt = new Date("2026-10-01T16:00:00Z");
    expect(decisionReview(row, now)).toMatchObject({
      category: "follow_up",
      whatHappened: text,
    });
  },
);

it("retains exact task types without treating a reply reminder as evidence of incoming mail", () => {
  expect(kindFor("reply", null, true)).toBe("follow_up");
  expect(kindFor("response", null, true)).toBe("follow_up");
  expect(kindFor("callback", null, true)).toBe("callback");
  expect(kindFor("draft", null, true)).toBe("draft");
  expect(kindFor(null, "ready_to_contact", false)).toBe("draft");
  expect(reasonFor("draft", false, null)).toBe("Draft review");
});

it("keeps tracked incoming replies actionable and deduplicates only explicitly linked reminders", () => {
  const linked = reminder("Check for reply");
  const unrelated = { ...linked, id: "other", sourceId: "other" };
  attachVerifiedAttentionIdentity(
    [linked, unrelated],
    [
      {
        followup_id: "reminder",
        profile_id: "profile",
        gmail_connection_id: "account",
        thread_id: "thread",
      },
    ],
  );
  const incoming: MasterWorkCandidate = {
    ...linked,
    id: "attention",
    sourceId: "attention",
    sourceType: "email_thread_attention",
    kind: "reply",
    attentionState: "needs_your_reply",
    reason: "Needs your reply",
  };
  const queue = buildMasterTodayQueue([linked, unrelated, incoming], now);
  expect(queue.needsAttention.map((x) => x.id)).toEqual(["attention"]);
  expect(queue.active.map((x) => x.id)).toEqual(["other"]);
  expect(decisionReview(incoming, now)).toMatchObject({ category: "reply" });
});
