import { it, expect } from "vitest";
import { applyAttentionLabels } from "./email-thread-attention-labels";
function harness() {
  const attached = new Set(["INBOX", "UNREAD", "unrelated", "oldProfile"]);
  const steps: any[] = [];
  let fail = false,
    changed = false;
  const gmail: any = {
    listLabels: async () => [
      { id: "attention", name: "Needs Attention", type: "user" },
    ],
    getThreadLabelIds: async () => [...attached],
    createLabel: async () => {
      throw Error("should reuse");
    },
    modifyThreadLabels: async (input: any) => {
      steps.push(input);
      if (fail) throw Error("offline");
      input.addLabelIds.forEach((x: string) => attached.add(x));
      input.removeLabelIds.forEach((x: string) => attached.delete(x));
    },
  };
  return {
    gmail,
    attached,
    steps,
    fail: () => {
      fail = true;
    },
    changed: () => {
      changed = true;
    },
    guard: async () => {
      if (changed) throw Error("new reply");
    },
  };
}
it("adds both labels before archiving while preserving unrelated labels and unread", async () => {
  const h = harness();
  await applyAttentionLabels(
    h.gmail,
    {
      threadId: "t",
      profileLabelId: "profile",
      oldProfileLabelIds: ["oldProfile"],
      state: "needs_your_reply",
      archive: true,
    },
    h.guard,
  );
  expect(h.steps[0].removeLabelIds).toEqual([]);
  expect(h.steps[0].addLabelIds).toEqual(["profile", "attention"]);
  expect([...h.attached].sort()).toEqual([
    "UNREAD",
    "attention",
    "profile",
    "unrelated",
  ]);
});
it("keeps Inbox when labels fail or a newer reply arrives", async () => {
  const h = harness();
  h.fail();
  await expect(
    applyAttentionLabels(
      h.gmail,
      {
        threadId: "t",
        profileLabelId: "profile",
        oldProfileLabelIds: [],
        state: "waiting_for_their_reply",
        archive: true,
      },
      h.guard,
    ),
  ).rejects.toThrow();
  expect(h.attached.has("INBOX")).toBe(true);
  const next = harness();
  const modify = next.gmail.modifyThreadLabels;
  next.gmail.modifyThreadLabels = async (i: any) => {
    await modify(i);
    next.changed();
  };
  await expect(
    applyAttentionLabels(
      next.gmail,
      {
        threadId: "t",
        profileLabelId: "profile",
        oldProfileLabelIds: [],
        state: "needs_your_reply",
        archive: true,
      },
      next.guard,
    ),
  ).rejects.toThrow("new reply");
  expect(next.attached.has("INBOX")).toBe(true);
});
it("resolution removes only attention and preserves profile history labels", async () => {
  const h = harness();
  h.attached.add("attention");
  await applyAttentionLabels(
    h.gmail,
    {
      threadId: "t",
      profileLabelId: "profile",
      oldProfileLabelIds: [],
      state: "resolved",
      archive: false,
    },
    h.guard,
  );
  expect(h.attached.has("attention")).toBe(false);
  expect(h.attached.has("profile")).toBe(true);
  expect(h.attached.has("INBOX")).toBe(true);
});
it("recovers when another worker creates the exact attention label", async () => {
  const h = harness();
  let list = 0;
  h.gmail.listLabels = async () =>
    ++list === 1
      ? []
      : [{ id: "attention", name: "Needs Attention", type: "user" }];
  h.gmail.createLabel = async () => {
    throw Error("already exists");
  };
  await applyAttentionLabels(
    h.gmail,
    {
      threadId: "t",
      profileLabelId: "profile",
      oldProfileLabelIds: [],
      state: "waiting_for_their_reply",
      archive: true,
    },
    h.guard,
  );
  expect(h.attached.has("attention")).toBe(true);
  expect(h.attached.has("INBOX")).toBe(false);
});
