import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: {} }));

import { encryptGoogleSecret } from "./encrypted-google-secret";
import { GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE } from "./google-api-client";
import { PostgresGoogleConnectionRepository, type GoogleConnectionSqlPool } from "./google-connection-repository";
import type { GoogleWorkspaceEnvironment } from "./google-workspace-env";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  appOrigin: "https://app.example.com",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 9)),
};

function pool(scopes = [GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE]): GoogleConnectionSqlPool {
  const encrypted = encryptGoogleSecret("stored-refresh-token", environment.tokenEncryptionKey);
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: "connection-id",
        account_email: "zone@example.com",
        status: "connected",
        encrypted_refresh_token: encrypted,
        granted_scopes: scopes,
        google_subject: null,
        connected_at: new Date("2026-08-22T18:00:00.000Z"),
        last_verified_at: new Date("2026-08-22T18:00:00.000Z"),
        disconnected_at: null,
        last_error_code: null,
        created_at: new Date("2026-08-22T18:00:00.000Z"),
        updated_at: new Date("2026-08-22T18:00:00.000Z"),
      }],
      rowCount: 1,
    })),
  };
}

describe("Google connection Gmail delivery client", () => {
  it("decrypts the stored refresh token and constructs a delivery client for the existing account", async () => {
    const createDeliveryClient = vi.fn(() => ({
      updateGmailDraft: vi.fn(),
      sendGmailDraft: vi.fn(),
    }));
    const repository = new PostgresGoogleConnectionRepository({
      pool: pool(),
      environment,
      createDeliveryClient,
    } as any);

    const connected = await repository.createGmailDeliveryClient();

    expect(connected?.connectionId).toBe("connection-id");
    expect(createDeliveryClient).toHaveBeenCalledWith({
      environment,
      refreshToken: "stored-refresh-token",
    });
  });

  it("requires Gmail compose reauthorization before constructing a delivery client", async () => {
    const repository = new PostgresGoogleConnectionRepository({
      pool: pool([]),
      environment,
      createDeliveryClient: vi.fn(),
    } as any);

    await expect(repository.createGmailDeliveryClient()).rejects.toThrow("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
  });
});
