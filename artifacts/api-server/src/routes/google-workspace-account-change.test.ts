import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { GOOGLE_WORKSPACE_READ_SCOPES } from "@/features/google-workspace/google-api-client";
import type { GoogleWorkspaceEnvironment } from "@/features/google-workspace/google-workspace-env";
import { createGoogleWorkspaceOAuthCallbackRouter } from "./google-workspace-oauth-callback";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  appOrigin: "https://app.example.com",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 6)),
};

describe("Google Workspace account replacement safety", () => {
  it("requires the owner to disconnect before connecting a different account", async () => {
    const app = express();
    app.use(
      createGoogleWorkspaceOAuthCallbackRouter({
        getEnvironment: () => ({ configured: true, value: environment }),
        stateRepository: {
          create: async () => undefined,
          consume: async () => ({
            returnPath: "/settings/google-workspace",
          }),
          deleteExpired: async () => 0,
        },
        connectionRepository: {
          upsertConnected: async () => {
            throw new Error(
              "GOOGLE_WORKSPACE_ACCOUNT_CHANGE_REQUIRES_DISCONNECT",
            );
          },
        },
        createClient: () => ({
          authorizationUrl: () => "",
          exchangeCode: async () => ({
            refreshToken: "new-refresh-token",
            scopes: [...GOOGLE_WORKSPACE_READ_SCOPES],
          }),
          accountIdentity: async () => ({
            subject: "different-subject",
            email: "different@example.com",
          }),
          listLabels: async () => [],
          listCalendars: async () => [],
        }),
        now: () => new Date("2026-08-22T21:00:00.000Z"),
      }),
    );

    const response = await request(app)
      .get("/google-workspace/oauth/callback?code=code&state=state")
      .expect(409);

    expect(response.body).toEqual({
      error: "GOOGLE_WORKSPACE_ACCOUNT_CHANGE_REQUIRES_DISCONNECT",
    });
  });
});
