import { it, expect } from "vitest";
import { attachVerifiedAttentionIdentity } from "./thread-attention-identity";
it("projects exact linked-reminder thread identity without guessing by profile", () => {
  const linked: any = {
    sourceType: "follow_up",
    sourceId: "reminder",
    kind: "reply",
    organizationId: "profile",
  };
  const unrelated: any = { ...linked, sourceId: "other" };
  const row = {
    followup_id: "reminder",
    profile_id: "profile",
    gmail_connection_id: "account",
    thread_id: "thread",
  };
  attachVerifiedAttentionIdentity([linked, unrelated], [row]);
  expect(linked.threadId).toBe("thread");
  expect(linked.gmailConnectionId).toBe("account");
  expect(unrelated.threadId).toBeUndefined();
  const ambiguous: any = {
    sourceType: "follow_up",
    sourceId: "reminder",
    kind: "reply",
    organizationId: "profile",
  };
  attachVerifiedAttentionIdentity(
    [ambiguous],
    [row, { ...row, thread_id: "second" }],
  );
  expect(ambiguous.threadId).toBeUndefined();
});
