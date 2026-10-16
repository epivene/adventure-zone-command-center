import { expect, it } from "vitest";
import { createGoogleWorkspaceReadClient } from "./google-api-client";
const environment = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://example.com/callback",
  appOrigin: "https://example.com",
  tokenEncryptionKey: new Uint8Array(32),
};
function client(payload: unknown, status = 200) {
  const urls: string[] = [];
  const api = createGoogleWorkspaceReadClient({
    environment,
    refreshToken: "refresh",
    fetcher: async (url, init) => {
      if (String(url).includes("oauth2.googleapis.com"))
        return new Response(
          JSON.stringify({ access_token: "token", expires_in: 3600 }),
        );
      expect(init?.method ?? "GET").toBe("GET");
      urls.push(String(url));
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "retry-after": "90" },
      });
    },
  });
  return { api, urls };
}
it("preserves large history cursors and deduplicates all change kinds without a label filter", async () => {
  const { api, urls } = client({
    historyId: "90071992547409931234",
    nextPageToken: "next",
    history: [
      {
        messagesAdded: [{ message: { id: "a", threadId: "t1" } }],
        messagesDeleted: [{ message: { id: "b", threadId: "t2" } }],
        labelsAdded: [{ message: { id: "a", threadId: "t1" } }],
        labelsRemoved: [{ message: { id: "c", threadId: "t3" } }],
      },
    ],
  });
  expect(
    await api.mailboxSync!.listHistory({
      startHistoryId: "90071992547409930000",
    }),
  ).toEqual({
    historyId: "90071992547409931234",
    nextPageToken: "next",
    changedThreads: ["t1", "t2", "t3"],
  });
  expect(new URL(urls[0]).searchParams.get("labelId")).toBeNull();
  expect(new URL(urls[0]).searchParams.get("maxResults")).toBe("100");
});
it("reads mailbox boundary and rejects a missing history cursor", async () => {
  expect(
    await client({
      emailAddress: "owner@example.com",
      historyId: "42",
    }).api.mailboxSync!.getMailbox(),
  ).toEqual({ email: "owner@example.com", historyId: "42" });
  await expect(
    client({}).api.mailboxSync!.listHistory({ startHistoryId: "42" }),
  ).rejects.toThrow("SYNC_INVALID_RESPONSE");
});
it("distinguishes expired cursor from source disappearance and retains retry delay", async () => {
  await expect(
    client({}, 404).api.mailboxSync!.listHistory({ startHistoryId: "42" }),
  ).rejects.toMatchObject({ kind: "expired_cursor" });
  await expect(
    client({}, 429).api.mailboxSync!.listHistory({ startHistoryId: "42" }),
  ).rejects.toMatchObject({ kind: "retryable", retryAfterMs: 90000 });
});
it("bounds sync requests and rejects oversized responses before parsing", async () => {
  const api = createGoogleWorkspaceReadClient({
    environment,
    refreshToken: "refresh",
    fetcher: async (url, init) => {
      if (String(url).includes("oauth2.googleapis.com"))
        return new Response(
          JSON.stringify({ access_token: "token", expires_in: 3600 }),
        );
      expect(init?.signal).toBeDefined();
      return new Response("{}", { headers: { "content-length": "20000000" } });
    },
  });
  await expect(api.mailboxSync!.getMailbox()).rejects.toMatchObject({
    kind: "invalid",
    code: "SYNC_RESPONSE_TOO_LARGE",
  });
});
it("reads only header metadata when deciding whether a new thread belongs to a known customer", async () => {
  const { api, urls } = client({
    id: "t",
    messages: [
      {
        id: "m",
        payload: {
          headers: [
            { name: "From", value: "Fair <fair@example.com>" },
            { name: "Subject", value: "Next year" },
          ],
        },
      },
    ],
  });
  expect(await api.mailboxSync!.getThreadHeaders!("t")).toEqual({
    id: "t",
    participants: ["Fair <fair@example.com>"],
    subject: "Next year",
  });
  expect(new URL(urls[0]).searchParams.get("format")).toBe("metadata");
});
it("caps aggregate MIME hydration across many small attachment responses", async () => {
  let reads = 0;
  const api = createGoogleWorkspaceReadClient({
    environment,
    refreshToken: "refresh",
    fetcher: async (url) => {
      if (String(url).includes("oauth2.googleapis.com"))
        return new Response(
          JSON.stringify({ access_token: "token", expires_in: 3600 }),
        );
      reads++;
      return new Response(
        JSON.stringify(
          String(url).includes("/attachments/")
            ? { data: Buffer.alloc(1024 * 1024).toString("base64") }
            : {
                id: "t",
                messages: [
                  {
                    id: "m",
                    labelIds: ["SENT"],
                    payload: {
                      parts: Array.from({ length: 10 }, (_, i) => ({
                        mimeType: "text/plain",
                        body: { attachmentId: "a" + i },
                      })),
                    },
                  },
                ],
              },
        ),
      );
    },
  });
  const outcome = await api.getSyncThreadDetail!("t").then(
    () => ({ code: "unexpected success" }),
    (error) => ({ code: error.code }),
  );
  expect(outcome).toEqual({ code: "SYNC_THREAD_REVIEW_REQUIRED" });
  expect(reads).toBeLessThan(11);
});
