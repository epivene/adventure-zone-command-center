import { it, expect } from "vitest";
import { createGoogleWorkspaceReadClient } from "../google-workspace/google-api-client";
const environment = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://example.test/callback",
  appOrigin: "https://example.test",
  tokenEncryptionKey: new Uint8Array(32),
};
it("preserves thread ID on save and reads the actual Gmail draft", async () => {
  const requests: { url: string; body: any }[] = [];
  const client = createGoogleWorkspaceReadClient({
    environment,
    refreshToken: "test",
    fetcher: async (url, init) => {
      requests.push({
        url: String(url),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Response.json(
        String(url).includes("oauth2")
          ? { access_token: "token", expires_in: 3600 }
          : { id: "d", message: { id: "m", threadId: "t", raw: "SGVsbG8" } },
      );
    },
  }) as any;
  await client.createGmailDraft({ raw: "SGVsbG8", threadId: "t" });
  expect(requests[1].body.message.threadId).toBe("t");
  expect(await client.getGmailDraftRaw("d")).toEqual({
    draftId: "d",
    messageId: "m",
    threadId: "t",
    raw: "SGVsbG8",
  });
  expect(requests.at(-1)?.url).toContain("format=raw");
});
