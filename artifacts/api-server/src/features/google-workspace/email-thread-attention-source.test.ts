import { it, expect, vi, afterEach } from "vitest";
const data = vi.hoisted(() => ({
  labels: [] as string[],
  messages: null as any[] | null,
}));
vi.mock("./google-connection-repository", () => ({
  PostgresGoogleConnectionRepository: class {
    async getCurrent() {
      return { id: "account", email: "office@example.com" };
    }
    async createReadClient() {
      return {
        getMessageMetadata: async () => ({
          threadId: "thread",
          hasAttachments: false,
          labelIds: data.labels,
          headers: { from: "customer@example.com", to: "office@example.com" },
        }),
        getThreadDetail: async () => ({
          id: "thread",
          subject: "Reply",
          messages: data.messages ?? [
            {
              id: "message",
              internalDateMs: 1,
              from: "Customer <customer@example.com>",
              to: "office@example.com",
              direction: "unknown",
              labelIds: data.labels,
            },
          ],
        }),
      };
    }
  },
}));
import { readAttentionSource } from "./email-thread-attention-source";
it("recognizes an archived, already-read external reply without INBOX", async () => {
  expect((await readAttentionSource("message")).latestDirection).toBe(
    "incoming",
  );
});

it("does not mistake sent mail or drafts for incoming replies", async () => {
  data.labels = ["SENT"];
  expect((await readAttentionSource("message")).latestDirection).toBe(
    "outgoing",
  );
  data.labels = ["DRAFT"];
  expect((await readAttentionSource("message")).latestDirection).toBe(
    "unknown",
  );
  data.labels = [];
});

afterEach(() => {
  data.messages = null;
  data.labels = [];
});
function message() {
  return {
    id: "message",
    internalDateMs: 1,
    from: "customer@example.com",
    to: "office@example.com",
    cc: "",
    date: "today",
    subject: "Proposal",
    direction: "incoming",
    bodyText: "See revised proposal",
    attachments: [
      {
        messageId: "message",
        attachmentId: "download-reference-1",
        filename: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      },
    ],
  };
}
it("keeps an unchanged message stable when only attachment retrieval references change", async () => {
  data.messages = [message()];
  const before = await readAttentionSource("message");
  data.messages[0].attachments[0].attachmentId = "download-reference-2";
  expect((await readAttentionSource("message")).sourceFingerprint).toBe(
    before.sourceFingerprint,
  );
});
it("ignores label-derived direction changes in the source fingerprint", async () => {
  data.messages = [message()];
  const before = await readAttentionSource("message");
  data.messages[0].direction = "unknown";
  expect((await readAttentionSource("message")).sourceFingerprint).toBe(
    before.sourceFingerprint,
  );
});
it("reports attachments from full thread content even when metadata omits MIME parts", async () => {
  data.messages = [
    message(),
    { ...message(), id: "reply", internalDateMs: 2, attachments: [] },
  ];
  expect((await readAttentionSource("message")).hasAttachments).toBe(true);
});
it("still detects changed text, attachment descriptors and new incoming messages", async () => {
  data.messages = [message()];
  const before = await readAttentionSource("message");
  data.messages[0].bodyText = "Different content";
  expect((await readAttentionSource("message")).sourceFingerprint).not.toBe(
    before.sourceFingerprint,
  );
  data.messages = [message()];
  data.messages[0].attachments[0].filename = "different.pdf";
  expect((await readAttentionSource("message")).sourceFingerprint).not.toBe(
    before.sourceFingerprint,
  );
  data.messages = [message(), { ...message(), id: "new", internalDateMs: 2 }];
  expect((await readAttentionSource("message")).sourceFingerprint).not.toBe(
    before.sourceFingerprint,
  );
});
