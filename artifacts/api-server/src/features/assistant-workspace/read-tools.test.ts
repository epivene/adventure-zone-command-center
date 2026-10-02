import { it, expect, vi } from "vitest";
import { createReadTools, threadEvidence } from "./read-tools";
import { emptySelection, type RunContext } from "./contracts";
const context: RunContext = {
  actor: { id: "owner", role: "owner", connectionId: "g1" },
  conversationId: "c",
  runId: "r",
  selection: emptySelection(),
  grants: [],
  signal: new AbortController().signal,
};
it("includes sent history and retains incomplete status", () => {
  const e = threadEvidence({
    id: "t1",
    complete: false,
    retrievedAt: "2026-09-24T12:00:00Z",
    messages: [
      { id: "m1", direction: "incoming", bodyText: "Deposit?" },
      { id: "m2", direction: "outgoing", bodyText: "40%" },
    ],
  });
  expect(e.complete).toBe(false);
  expect(e.text).toContain("m2");
  expect(e.text).toContain("40%");
});
it("paginates by stable Gmail IDs, never by subject", async () => {
  const page = vi.fn().mockResolvedValue({
    messages: [
      { id: "m1", threadId: "t1" },
      { id: "m2", threadId: "t2" },
    ],
    nextPageToken: "next",
  });
  const t = createReadTools({
    ownerId: "owner",
    gmail: async () => ({
      connectionId: "g1",
      client: { listMessagePage: page } as any,
    }),
  });
  const r = await t.execute(context, {
    id: "call",
    name: "search_email",
    arguments: JSON.stringify({ query: "subject:Fair", cursor: "prior" }),
  });
  expect(r.status).toBe("ok");
  expect(r.data).toMatchObject({
    nextPageToken: "next",
    messages: [{ id: "m1" }, { id: "m2" }],
  });
  expect(page).toHaveBeenCalledWith({
    maxResults: 25,
    query: "subject:Fair",
    pageToken: "prior",
  });
});
it.each([
  null,
  { connectionId: "g2", client: {} },
  { connectionId: "g1", client: {} },
])(
  "blocks unavailable, switched or unsupported Gmail connections",
  async (connection) => {
    const t = createReadTools({
      ownerId: "owner",
      gmail: async () => connection as any,
    });
    const r = await t.execute(context, {
      id: "a",
      name: "read_email_thread",
      arguments: '{"threadId":"t"}',
    });
    expect(r.status).toBe("blocked");
    expect(r.evidence).toEqual([]);
  },
);
it("does not expose tools to another actor", async () => {
  const gmail = vi.fn();
  const t = createReadTools({ ownerId: "owner", gmail });
  const other = { ...context, actor: { ...context.actor, id: "other" } };
  expect(t.definitions(other)).toEqual([]);
  expect(
    (
      await t.execute(other, {
        id: "a",
        name: "search_email",
        arguments: '{"query":"all"}',
      })
    ).status,
  ).toBe("blocked");
  expect(gmail).not.toHaveBeenCalled();
});
it("returns complete live sent-only threads with attachment references", async () => {
  const t = createReadTools({
    ownerId: "owner",
    gmail: async () => ({
      connectionId: "g1",
      client: {
        getThreadDetail: async () => ({
          id: "t",
          messages: [
            {
              id: "m",
              direction: "outgoing",
              bodyText: "sent only",
              attachments: [{ attachmentId: "a" }],
            },
          ],
        }),
      } as any,
    }),
  });
  const r = await t.execute(context, {
    id: "a",
    name: "read_email_thread",
    arguments: '{"threadId":"t"}',
  });
  expect(r.evidence[0].complete).toBe(true);
  expect(r.evidence[0].text).toContain("sent only");
  expect(r.data).toMatchObject({
    messages: [{ attachments: [{ attachmentId: "a" }] }],
  });
});

async function reviewThread(messages: any[]) {
  const tools = createReadTools({
    ownerId: "owner",
    gmail: async () => ({connectionId: "g1", client: {
      getThreadDetail: async () => ({id: "buffalo", subject: "Buffalo Bill Days", originalGmailUrl: "https://mail.google.com/mail/u/0/#all/buffalo", messages}),
    } as any}),
  });
  return tools.execute(context, {id: "review", name: "read_email_thread", arguments: '{"threadId":"buffalo"}'});
}
const email = (id: string, direction: string, bodyText: string, internalDateMs = 1) => ({
  id, direction, bodyText, internalDateMs, from: "event@example.com", to: "owner@example.com",
  cc: "", subject: "Buffalo Bill Days", date: "", attachments: [],
});
it("retains an automatic acknowledgment's website instruction as work requiring verification and owner approval", async () => {
  const r = await reviewThread([email("ack", "incoming",
    "This is an automatic acknowledgment. Our inbox is not constantly monitored.\nPlease visit https://goldenbuffalobilldays.com/ for vendor applications.")]);
  expect(r.data).toMatchObject({nextStepReview: {
    sourceMessageId: "ack", state: "verification_required",
    candidates: [{messageId: "ack", sourceText: "Please visit https://goldenbuffalobilldays.com/ for vendor applications.",
      urls: ["https://goldenbuffalobilldays.com/"]}],
    approvalRequired: {sendEmail: true, submitForm: true},
  }});
  expect(r.receipts).toEqual([]);
  expect(r.evidence[0].text).toContain("automatic acknowledgment");
});
it("does not turn a bare receipt into an application requirement", async () => {
  const r = await reviewThread([email("ack", "incoming", "Thank you. This is an automatic acknowledgment. We received your email.")]);
  expect(r.data).toMatchObject({nextStepReview: {sourceMessageId: "ack", candidates: [],
    state: "verification_required", approvalRequired: {sendEmail: true, submitForm: true}}});
});
it("reviews the latest incoming source without treating sent mail or quoted old applications as new instructions", async () => {
  const r = await reviewThread([
    email("old", "incoming", "Please apply using https://old.example/form", 1),
    email("new", "incoming", "We received your message.\nOn Monday, Owner wrote:\nPlease apply using https://old.example/form", 2),
    email("sent", "outgoing", "Please apply using https://sent.example/form", 3),
  ]);
  expect(r.data).toMatchObject({nextStepReview: {sourceMessageId: "new", candidates: []}});
  expect((r.data as any).messages).toHaveLength(3);
});
it("surfaces deadlines and alternate contacts even without an application URL", async () => {
  const r = await reviewThread([email("ack", "incoming",
    "Applications close March 1.\nPlease contact the entertainment coordinator for attractions.")]);
  expect(r.data).toMatchObject({nextStepReview: {candidates: [
    {sourceText: "Applications close March 1."},
    {sourceText: "Please contact the entertainment coordinator for attractions."},
  ]}});
});
