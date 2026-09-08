import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { GOOGLE_WORKSPACE_REQUIRED_SCOPES } from "@/features/google-workspace/google-api-client";
import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import type { GoogleWorkspaceEnvironment } from "@/features/google-workspace/google-workspace-env";
import { createGoogleWorkspaceOAuthCallbackRouter } from "./google-workspace-oauth-callback";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  appOrigin: "https://app.example.com",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 2)),
};

function testApp(options?: {
  configured?: boolean;
  consume?: ReturnType<typeof vi.fn>;
  exchangeCode?: ReturnType<typeof vi.fn>;
  accountIdentity?: ReturnType<typeof vi.fn>;
  upsertConnected?: ReturnType<typeof vi.fn>;
}) {
  const consume =
    options?.consume ??
    vi.fn(async () => ({ returnPath: "/settings/google-workspace" }));
  const exchangeCode =
    options?.exchangeCode ??
    vi.fn(async () => ({
      refreshToken: "1//refresh-token",
      scopes: [...GOOGLE_WORKSPACE_REQUIRED_SCOPES],
    }));
  const accountIdentity =
    options?.accountIdentity ??
    vi.fn(async () => ({
      subject: "google-subject",
      email: "zone@example.com",
    }));
  const upsertConnected =
    options?.upsertConnected ?? vi.fn(async () => ({ id: "connection-id" }));
  const client: GoogleWorkspaceReadClient = {
    authorizationUrl: () => "",
    exchangeCode,
    accountIdentity,
    listLabels: async () => [],
    listCalendars: async () => [],
  };
  const router = createGoogleWorkspaceOAuthCallbackRouter({
    getEnvironment: () =>
      options?.configured === false
        ? { configured: false as const }
        : { configured: true as const, value: environment },
    stateRepository: {
      create: async () => undefined,
      consume,
      deleteExpired: async () => 0,
    },
    connectionRepository: { upsertConnected },
    createClient: vi.fn(() => client),
    now: () => new Date("2026-08-22T18:05:00.000Z"),
  });
  const app = express();
  app.use(router);
  return { app, consume, exchangeCode, accountIdentity, upsertConnected };
}

describe("Google Workspace OAuth callback", () => {
  it("rejects missing code or state", async () => {
    const { app, consume } = testApp();

    await request(app).get("/google-workspace/oauth/callback").expect(400);
    await request(app)
      .get("/google-workspace/oauth/callback?code=code")
      .expect(400);
    expect(consume).not.toHaveBeenCalled();
  });

  it("does not consume state while Google Workspace is unconfigured", async () => {
    const { app, consume } = testApp({ configured: false });

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=code&state=state")
      .expect(503);

    expect(response.body.error).toBe("GOOGLE_WORKSPACE_NOT_CONFIGURED");
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects expired, invalid, or replayed state before exchanging a code", async () => {
    const consume = vi.fn(async () => null);
    const { app, exchangeCode } = testApp({ consume });

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=code&state=expired")
      .expect(400);

    expect(response.body.error).toBe("GOOGLE_WORKSPACE_OAUTH_STATE_INVALID");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("exchanges a valid code, verifies identity and scopes, then returns to the frontend", async () => {
    const { app, consume, exchangeCode, accountIdentity, upsertConnected } =
      testApp();

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=auth-code&state=oauth-state")
      .expect(303);

    expect(consume).toHaveBeenCalledWith({
      state: "oauth-state",
      now: new Date("2026-08-22T18:05:00.000Z"),
    });
    expect(exchangeCode).toHaveBeenCalledWith("auth-code");
    expect(accountIdentity).toHaveBeenCalledOnce();
    expect(upsertConnected).toHaveBeenCalledWith({
      accountEmail: "zone@example.com",
      googleSubject: "google-subject",
      refreshToken: "1//refresh-token",
      scopes: [...GOOGLE_WORKSPACE_REQUIRED_SCOPES],
      now: new Date("2026-08-22T18:05:00.000Z"),
    });
    expect(response.headers.location).toBe(
      "https://app.example.com/settings/google-workspace?connected=1",
    );
  });

  it("never redirects an OAuth callback outside the configured frontend origin", async () => {
    const consume = vi.fn(async () => ({ returnPath: "//evil.example/steal" }));
    const { app } = testApp({ consume });

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=auth-code&state=oauth-state")
      .expect(303);

    expect(response.headers.location).toBe(
      "https://app.example.com/settings/google-workspace?connected=1",
    );
  });

  it("refuses a connection missing any required least-privilege scope", async () => {
    const exchangeCode = vi.fn(async () => ({
      refreshToken: "1//refresh-token",
      scopes: GOOGLE_WORKSPACE_REQUIRED_SCOPES.filter(
        (scope) => scope !== "https://www.googleapis.com/auth/gmail.modify",
      ),
    }));
    const { app, upsertConnected } = testApp({ exchangeCode });

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=code&state=state")
      .expect(403);

    expect(response.body.error).toBe(
      "GOOGLE_WORKSPACE_REQUIRED_SCOPES_MISSING",
    );
    expect(upsertConnected).not.toHaveBeenCalled();
  });

  it("refuses a connection when Google omits the granted scope list", async () => {
    const exchangeCode = vi.fn(async () => ({
      refreshToken: "1//refresh-token",
      scopes: [],
    }));
    const { app, upsertConnected } = testApp({ exchangeCode });

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=code&state=state")
      .expect(403);

    expect(response.body.error).toBe(
      "GOOGLE_WORKSPACE_REQUIRED_SCOPES_MISSING",
    );
    expect(upsertConnected).not.toHaveBeenCalled();
  });

  it("refuses a grant that includes an unexpected Google scope", async () => {
    const exchangeCode = vi.fn(async () => ({
      refreshToken: "1//refresh-token",
      scopes: [
        ...GOOGLE_WORKSPACE_REQUIRED_SCOPES,
        "https://www.googleapis.com/auth/gmail.settings.basic",
      ],
    }));
    const { app, upsertConnected } = testApp({ exchangeCode });

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=code&state=state")
      .expect(403);

    expect(response.body.error).toBe(
      "GOOGLE_WORKSPACE_UNEXPECTED_SCOPE_GRANTED",
    );
    expect(upsertConnected).not.toHaveBeenCalled();
  });

  it("returns only a safe error code when Google rejects the exchange", async () => {
    const exchangeCode = vi.fn(async () => {
      throw Object.assign(new Error("client-secret should never be returned"), {
        code: "GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED",
      });
    });
    const { app } = testApp({ exchangeCode });

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=code&state=state")
      .expect(502);

    expect(response.body).toEqual({
      error: "GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED",
    });
    expect(JSON.stringify(response.body)).not.toContain("client-secret");
  });
});
