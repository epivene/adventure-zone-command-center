import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import {
  PostgresGoogleConnectionRepository,
  type GoogleConnectionSqlPool,
} from "./google-connection-repository";
import type { GoogleWorkspaceEnvironment } from "./google-workspace-env";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 9)),
};

function repositoryHarness() {
  const row: Record<string, unknown> = {};
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pool: GoogleConnectionSqlPool = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("INSERT INTO google_workspace_connections")) {
        Object.assign(row, {
          id: "connection-id",
          account_email: values[0],
          status: "connected",
          encrypted_refresh_token: values[1],
          granted_scopes: values[2],
          google_subject: values[3],
          connected_at: values[4],
          last_verified_at: values[4],
          disconnected_at: null,
          last_error_code: null,
          created_at: values[4],
          updated_at: values[4],
        });
        return { rows: [row], rowCount: 1 };
      }
      if (text.includes("FROM google_workspace_connections")) {
        return { rows: Object.keys(row).length ? [row] : [], rowCount: 1 };
      }
      if (text.includes("reauthorization_required")) {
        row.status = "reauthorization_required";
        row.last_error_code = values[0];
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("SET status = 'disconnected'")) {
        row.status = "disconnected";
        row.disconnected_at = values[0];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  return { row, calls, pool };
}

const fakeClient: GoogleWorkspaceReadClient = {
  authorizationUrl: () => "https://accounts.google.com/",
  exchangeCode: async () => ({ refreshToken: "unused", scopes: [] }),
  accountIdentity: async () => ({ subject: "subject", email: "zone@example.com" }),
  listLabels: async () => [],
  listCalendars: async () => [],
};

describe("PostgresGoogleConnectionRepository", () => {
  it("encrypts refresh credentials and never returns them in the settings view", async () => {
    const harness = repositoryHarness();
    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
      environment,
      createClient: vi.fn(() => fakeClient),
    });
    const refreshToken = "1//plaintext-refresh-token";

    const saved = await repository.upsertConnected({
      accountEmail: "zone@example.com",
      googleSubject: "google-subject",
      refreshToken,
      scopes: ["scope-a", "scope-b"],
      now: new Date("2026-08-22T18:00:00.000Z"),
    });

    expect(JSON.stringify(harness.row)).not.toContain(refreshToken);
    expect(saved).toEqual({
      id: "connection-id",
      email: "zone@example.com",
      status: "connected",
      grantedScopes: ["scope-a", "scope-b"],
      connectedAt: "2026-08-22T18:00:00.000Z",
      lastVerifiedAt: "2026-08-22T18:00:00.000Z",
      lastErrorCode: null,
    });
    expect(saved).not.toHaveProperty("refreshToken");
    expect(saved).not.toHaveProperty("encryptedRefreshToken");
  });

  it("decrypts inside the repository before constructing an authenticated client", async () => {
    const harness = repositoryHarness();
    const createClient = vi.fn(() => fakeClient);
    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
      environment,
      createClient,
    });

    await repository.upsertConnected({
      accountEmail: "zone@example.com",
      googleSubject: null,
      refreshToken: "stored-refresh-token",
      scopes: ["scope-a"],
      now: new Date("2026-08-22T18:00:00.000Z"),
    });

    await expect(repository.createReadClient()).resolves.toBe(fakeClient);
    expect(createClient).toHaveBeenCalledWith({
      environment,
      refreshToken: "stored-refresh-token",
    });
  });

  it("marks revoked credentials for reauthorization without deleting scope", async () => {
    const harness = repositoryHarness();
    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
      environment,
      createClient: () => fakeClient,
    });

    await repository.upsertConnected({
      accountEmail: "zone@example.com",
      googleSubject: null,
      refreshToken: "stored-refresh-token",
      scopes: ["scope-a"],
      now: new Date("2026-08-22T18:00:00.000Z"),
    });
    await repository.markReauthorizationRequired("invalid_grant");

    expect(harness.row.status).toBe("reauthorization_required");
    expect(harness.row.granted_scopes).toEqual(["scope-a"]);
  });

  it("disconnects the connection without exposing or erasing archived business data", async () => {
    const harness = repositoryHarness();
    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
      environment,
      createClient: () => fakeClient,
    });

    await repository.upsertConnected({
      accountEmail: "zone@example.com",
      googleSubject: null,
      refreshToken: "stored-refresh-token",
      scopes: [],
      now: new Date("2026-08-22T18:00:00.000Z"),
    });
    await repository.disconnect(new Date("2026-08-22T19:00:00.000Z"));

    expect(harness.row.status).toBe("disconnected");
    expect(harness.row.disconnected_at).toEqual(
      new Date("2026-08-22T19:00:00.000Z"),
    );
  });
});
