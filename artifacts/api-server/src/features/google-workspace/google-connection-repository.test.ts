import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE,
  GOOGLE_WORKSPACE_READ_SCOPES,
} from "./google-api-client";
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
  appOrigin: "https://app.example.com",
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
          granted_scopes: typeof values[2] === "string" ? JSON.parse(values[2]) : values[2],
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

const googleEnvironmentKeys = [
  "GOOGLE_WORKSPACE_CLIENT_ID",
  "GOOGLE_WORKSPACE_CLIENT_SECRET",
  "GOOGLE_WORKSPACE_REDIRECT_URI",
  "GOOGLE_WORKSPACE_APP_ORIGIN",
  "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY",
] as const;

function clearGoogleEnvironment() {
  for (const key of googleEnvironmentKeys) vi.stubEnv(key, "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PostgresGoogleConnectionRepository", () => {
  it("can be constructed and queried when Google Workspace is not configured", async () => {
    clearGoogleEnvironment();
    const harness = repositoryHarness();

    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
    });

    await expect(repository.getCurrent()).resolves.toBeNull();
    await expect(repository.createReadClient()).resolves.toBeNull();
    await expect(
      repository.upsertConnected({
        accountEmail: "zone@example.com",
        googleSubject: null,
        refreshToken: "refresh-token",
        scopes: [],
        now: new Date("2026-08-22T18:00:00.000Z"),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_NOT_CONFIGURED");
  });

  it("does not crash route construction or read-only queries for partial configuration", async () => {
    clearGoogleEnvironment();
    vi.stubEnv(
      "GOOGLE_WORKSPACE_CLIENT_ID",
      "client-id.apps.googleusercontent.com",
    );
    const harness = repositoryHarness();

    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
    });

    await expect(repository.getCurrent()).resolves.toBeNull();
    await expect(repository.createReadClient()).resolves.toBeNull();
    await expect(
      repository.upsertConnected({
        accountEmail: "zone@example.com",
        googleSubject: null,
        refreshToken: "refresh-token",
        scopes: [],
        now: new Date("2026-08-22T18:00:00.000Z"),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_CONFIGURATION_INCOMPLETE");
  });

  it("encrypts refresh credentials, audits the connection, and never returns credentials", async () => {
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
      scopes: [
        ...GOOGLE_WORKSPACE_READ_SCOPES,
        GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE,
      ],
      now: new Date("2026-08-22T18:00:00.000Z"),
    });

    expect(JSON.stringify(harness.row)).not.toContain(refreshToken);
    expect(harness.calls.some((call) =>
      call.text.includes("'connection_connected'"),
    )).toBe(true);
    expect(saved).toEqual({
      id: "connection-id",
      email: "zone@example.com",
      status: "connected",
      grantedScopes: [
        ...GOOGLE_WORKSPACE_READ_SCOPES,
        GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE,
      ],
      connectedAt: "2026-08-22T18:00:00.000Z",
      lastVerifiedAt: "2026-08-22T18:00:00.000Z",
      lastErrorCode: null,
    });
    expect(saved).not.toHaveProperty("refreshToken");
    expect(saved).not.toHaveProperty("encryptedRefreshToken");
  });

  it("keeps readonly access but requires explicit reauthorization before composing Gmail drafts", async () => {
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
      scopes: [...GOOGLE_WORKSPACE_READ_SCOPES],
      now: new Date("2026-08-22T18:00:00.000Z"),
    });

    await expect(repository.getCurrent()).resolves.toMatchObject({
      status: "reauthorization_required",
      lastErrorCode: "GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE_REQUIRED",
    });
    await expect(repository.createReadClient()).resolves.toBe(fakeClient);
    await expect(repository.createGmailDraftClient()).rejects.toThrow(
      "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    );
  });

  it("requires an explicit disconnect before replacing the active Google account", async () => {
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

    await expect(
      repository.upsertConnected({
        accountEmail: "personal@example.com",
        googleSubject: null,
        refreshToken: "different-refresh-token",
        scopes: ["scope-a"],
        now: new Date("2026-08-22T18:05:00.000Z"),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_ACCOUNT_CHANGE_REQUIRES_DISCONNECT");
    expect(harness.row.account_email).toBe("zone@example.com");
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
    expect(harness.calls.some((call) =>
      call.text.includes("'connection_reauthorization_required'"),
    )).toBe(true);
  });

  it("disconnects and audits without exposing or erasing archived business data", async () => {
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
    expect(harness.calls.some((call) =>
      call.text.includes("'connection_disconnected'"),
    )).toBe(true);
  });
});
