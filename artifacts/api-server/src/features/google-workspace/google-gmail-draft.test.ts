import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE,
  GOOGLE_WORKSPACE_REQUIRED_SCOPES,
  buildGmailRawMessage,
  createGoogleWorkspaceReadClient,
} from "./google-api-client";

const environment = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://example.test/api/google-workspace/oauth/callback",
  appOrigin: "https://example.test",
  tokenEncryptionKey: "x".repeat(32),
};

describe("Google Gmail draft-only client", () => {
  it("requires an explicit Gmail compose reauthorization without broader mutation scopes", () => {
    const client = createGoogleWorkspaceReadClient({ environment });
    const url = new URL(client.authorizationUrl({ state: "safe-state" }));
    const scopes = new Set((url.searchParams.get("scope") ?? "").split(" "));

    expect(scopes).toEqual(new Set(GOOGLE_WORKSPACE_REQUIRED_SCOPES));
    expect(scopes.has(GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE)).toBe(true);
    expect(scopes.has("https://www.googleapis.com/auth/gmail.modify")).toBe(false);
    expect(scopes.has("https://mail.google.com/")).toBe(false);
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
  });

  it("builds Gmail base64url MIME for Unicode and multiline text and rejects header injection", () => {
    const raw = buildGmailRawMessage({
      to: "desiree@example.com",
      subject: "Café — Aspen",
      body: "Hi José,\n\nSee https://example.com/events/1.\nThanks,\nDesiree",
    });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);

    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: desiree@example.com\r\n");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8\r\n");
    const encodedBody = mime.split("\r\n\r\n")[1]!;
    expect(Buffer.from(encodedBody.replace(/\r\n/g, ""), "base64").toString("utf8"))
      .toBe("Hi José,\n\nSee https://example.com/events/1.\nThanks,\nDesiree");

    expect(() => buildGmailRawMessage({ to: "ok@example.com\r\nBcc: attacker@example.com", subject: "Safe", body: "Body" }))
      .toThrow("GOOGLE_WORKSPACE_GMAIL_HEADER_INVALID");
    expect(() => buildGmailRawMessage({ to: "ok@example.com", subject: "Safe\nBcc: attacker@example.com", body: "Body" }))
      .toThrow("GOOGLE_WORKSPACE_GMAIL_HEADER_INVALID");
  });

  it("calls users.drafts.create exactly once and never retries an uncertain network outcome", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 });
      }
      if (url.endsWith("/gmail/v1/users/me/drafts")) {
        throw new TypeError("socket closed after request write");
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = createGoogleWorkspaceReadClient({ environment, refreshToken: "refresh", fetcher });

    await expect(client.createGmailDraft!({
      raw: buildGmailRawMessage({ to: "person@example.com", subject: "Hello", body: "Body" }),
    })).rejects.toMatchObject({ code: "GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN" });

    expect(urls.filter((url) => url.endsWith("/gmail/v1/users/me/drafts"))).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns Gmail draft and message identifiers from a successful draft creation", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 });
      }
      expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ message: { raw: "cmF3" } });
      return new Response(JSON.stringify({ id: "draft-1", message: { id: "message-1" } }), { status: 200 });
    });
    const client = createGoogleWorkspaceReadClient({ environment, refreshToken: "refresh", fetcher });

    await expect(client.createGmailDraft!({ raw: "cmF3" })).resolves.toEqual({
      draftId: "draft-1",
      messageId: "message-1",
    });
  });
});
