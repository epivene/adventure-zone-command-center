import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceEnvironment } from "@/features/google-workspace/google-workspace-env";
import { createGoogleWorkspaceOAuthCallbackRouter } from "./google-workspace-oauth-callback";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  appOrigin: "https://app.example.com",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 8)),
};

describe("Google Workspace OAuth denial", () => {
  it("consumes valid state and returns access denial to the frontend without echoing Google text", async () => {
    const consume = vi.fn(async () => ({
      returnPath: "/settings/google-workspace",
    }));
    const app = express();
    app.use(
      createGoogleWorkspaceOAuthCallbackRouter({
        getEnvironment: () => ({ configured: true, value: environment }),
        stateRepository: {
          create: async () => undefined,
          consume,
          deleteExpired: async () => 0,
        },
        connectionRepository: {
          upsertConnected: async () => ({ id: "unused" }),
        },
        createClient: () => {
          throw new Error("OAuth client must not be created for a denial");
        },
        now: () => new Date("2026-08-22T21:10:00.000Z"),
      }),
    );

    const response = await request(app)
      .get(
        "/google-workspace/oauth/callback?error=access_denied&error_description=private+provider+details&state=valid-state",
      )
      .expect(303);

    expect(consume).toHaveBeenCalledWith({
      state: "valid-state",
      now: new Date("2026-08-22T21:10:00.000Z"),
    });
    expect(response.headers.location).toBe(
      "https://app.example.com/settings/google-workspace?googleError=GOOGLE_WORKSPACE_OAUTH_ACCESS_DENIED",
    );
    expect(response.headers.location).not.toContain("private");
  });

  it("does not redirect a denial with invalid or replayed state", async () => {
    const app = express();
    app.use(
      createGoogleWorkspaceOAuthCallbackRouter({
        getEnvironment: () => ({ configured: true, value: environment }),
        stateRepository: {
          create: async () => undefined,
          consume: async () => null,
          deleteExpired: async () => 0,
        },
        connectionRepository: {
          upsertConnected: async () => ({ id: "unused" }),
        },
        createClient: () => {
          throw new Error("OAuth client must not be created for a denial");
        },
        now: () => new Date("2026-08-22T21:10:00.000Z"),
      }),
    );

    await request(app)
      .get(
        "/google-workspace/oauth/callback?error=access_denied&state=invalid-state",
      )
      .expect(400, { error: "GOOGLE_WORKSPACE_OAUTH_STATE_INVALID" });
  });
});
