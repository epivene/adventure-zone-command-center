import { it, expect, vi } from "vitest";
const data = vi.hoisted(() => ({ labels: [] as string[] }));
vi.mock("./google-connection-repository", () => ({
  PostgresGoogleConnectionRepository: class {
    async getCurrent() {
      return { id: "account", email: "office@example.com" };
    }
    async createReadClient() {
      return {
        getMessageMetadata: async () => ({
          threadId: "thread",
          labelIds: data.labels,
          headers: { from: "customer@example.com", to: "office@example.com" },
        }),
        getThreadDetail: async () => ({
          id: "thread",
          subject: "Reply",
          messages: [
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
