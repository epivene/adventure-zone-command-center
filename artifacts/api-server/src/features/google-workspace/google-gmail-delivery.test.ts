import { describe, expect, it, vi } from "vitest";

import { createGoogleGmailDeliveryClient } from "./google-gmail-delivery-client";

const environment = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://example.test/api/google-workspace/oauth/callback",
  appOrigin: "https://example.test",
  tokenEncryptionKey: Buffer.alloc(32, 1),
};

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 });
}

describe("Google Gmail delivery client", () => {
  it("updates an existing Gmail draft in place", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
      expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts/draft-1");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ message: { raw: "cmF3" } });
      return new Response(JSON.stringify({ id: "draft-1", message: { id: "message-2", threadId: "thread-1" } }), { status: 200 });
    });
    const client = createGoogleGmailDeliveryClient({ environment, refreshToken: "refresh", fetcher });

    await expect(client.updateGmailDraft({ draftId: "draft-1", raw: "cmF3" })).resolves.toEqual({
      draftId: "draft-1",
      messageId: "message-2",
      threadId: "thread-1",
    });
  });

  it("sends an existing Gmail draft exactly once and returns Gmail confirmation", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
      expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts/send");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ id: "draft-1" });
      return new Response(JSON.stringify({ id: "message-sent", threadId: "thread-1", labelIds: ["SENT"] }), { status: 200 });
    });
    const client = createGoogleGmailDeliveryClient({ environment, refreshToken: "refresh", fetcher });

    await expect(client.sendGmailDraft({ draftId: "draft-1" })).resolves.toEqual({
      messageId: "message-sent",
      threadId: "thread-1",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("sends a raw Gmail message without requiring an SMTP password", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
      expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ raw: "cmF3" });
      return new Response(JSON.stringify({ id: "message-sent", threadId: "thread-1", labelIds: ["SENT"] }), { status: 200 });
    });
    const client = createGoogleGmailDeliveryClient({ environment, refreshToken: "refresh", fetcher });

    await expect(client.sendGmailMessage({ raw: "cmF3" })).resolves.toEqual({
      messageId: "message-sent",
      threadId: "thread-1",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never retries an uncertain Gmail send outcome", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
      if (url.endsWith("/gmail/v1/users/me/drafts/send")) throw new TypeError("socket closed after request write");
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = createGoogleGmailDeliveryClient({ environment, refreshToken: "refresh", fetcher });

    await expect(client.sendGmailDraft({ draftId: "draft-1" })).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN",
    });
    expect(urls.filter((url) => url.endsWith("/gmail/v1/users/me/drafts/send"))).toHaveLength(1);
  });
});
