import { describe, expect, it } from "vitest";

import {
  PostgresGoogleConnectionRepository,
  type GoogleConnectionSqlPool,
} from "./google-connection-repository";
import type { GoogleWorkspaceEnvironment } from "./google-workspace-env";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  appOrigin: "https://app.example.com",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 4)),
};

const activeRow = {
  id: "connection-id",
  account_email: "company@example.com",
  status: "connected",
  encrypted_refresh_token: {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: "AA==",
    tag: "AA==",
    ciphertext: "AA==",
  },
  granted_scopes: [],
  google_subject: "original-google-subject",
  connected_at: new Date("2026-08-22T18:00:00.000Z"),
  last_verified_at: new Date("2026-08-22T18:00:00.000Z"),
  disconnected_at: null,
  last_error_code: null,
  created_at: new Date("2026-08-22T18:00:00.000Z"),
  updated_at: new Date("2026-08-22T18:00:00.000Z"),
};

function repository() {
  const pool: GoogleConnectionSqlPool = {
    async query(text) {
      if (text.includes("FROM google_workspace_connections")) {
        return { rows: [activeRow] };
      }
      throw new Error(`Unexpected write: ${text}`);
    },
  };
  return new PostgresGoogleConnectionRepository({ pool, environment });
}

describe("Google Workspace account subject safety", () => {
  it("requires disconnect when the email matches but Google's stable subject changed", async () => {
    await expect(
      repository().upsertConnected({
        accountEmail: "company@example.com",
        googleSubject: "replacement-google-subject",
        refreshToken: "replacement-refresh-token",
        scopes: [],
        now: new Date("2026-08-22T19:00:00.000Z"),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_ACCOUNT_CHANGE_REQUIRES_DISCONNECT");
  });

  it("does not erase a previously pinned Google subject when identity is missing", async () => {
    await expect(
      repository().upsertConnected({
        accountEmail: "company@example.com",
        googleSubject: null,
        refreshToken: "replacement-refresh-token",
        scopes: [],
        now: new Date("2026-08-22T19:00:00.000Z"),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_ACCOUNT_CHANGE_REQUIRES_DISCONNECT");
  });
});
