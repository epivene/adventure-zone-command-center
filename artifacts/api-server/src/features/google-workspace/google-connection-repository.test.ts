import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE,
  GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE,
  GOOGLE_WORKSPACE_READ_SCOPES,
} from "./google-api-client";
import type { GoogleWorkspaceReadClient } from "./google-api-types";

const legacyReadScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];
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
        const operationalCalendar = text.includes("VALUES ($1, 'operational_calendar'");
        Object.assign(row, {
          id: "connection-id",
          account_email: values[0],
          role: operationalCalendar ? "operational_calendar" : "workspace",
          operational_calendar_id: operationalCalendar ? values[1] : null,
          status: "connected",
          encrypted_refresh_token: values[operationalCalendar ? 2 : 1],
          granted_scopes: typeof values[operationalCalendar ? 3 : 2] === "string"
            ? JSON.parse(values[operationalCalendar ? 3 : 2] as string)
            : values[operationalCalendar ? 3 : 2],
          google_subject: values[operationalCalendar ? 4 : 3],
          connected_at: values[operationalCalendar ? 5 : 4],
          last_verified_at: values[operationalCalendar ? 5 : 4],
          disconnected_at: null,
          last_error_code: null,
          created_at: values[operationalCalendar ? 5 : 4],
          updated_at: values[operationalCalendar ? 5 : 4],
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
  createLabel: async (name) => ({ id: "Label_1", name, type: "user" }),
  deleteLabel: async () => undefined,
  renameLabel: async ({ labelId, name }) => ({ id: labelId, name, type: "user" }),
  getThreadLabelIds: async () => [],
  modifyThreadLabels: async () => undefined,
  modifyMessageLabels: async () => undefined,
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
  it("upserts workspace and operational-calendar credentials by account and role", async () => {
    const harness = repositoryHarness();
    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
      environment,
      createClient: () => fakeClient,
    });

    await repository.upsertConnected({
      accountEmail: "zone@example.com",
      googleSubject: "google-subject",
      refreshToken: "workspace-refresh-token",
      scopes: [...GOOGLE_WORKSPACE_READ_SCOPES],
      now: new Date("2026-08-22T18:00:00.000Z"),
    });

    const workspaceInsert = harness.calls.find((call) =>
      call.text.includes("INSERT INTO google_workspace_connections"),
    );
    expect(workspaceInsert?.text).toContain("ON CONFLICT (account_email, role)");

    harness.calls.length = 0;
    await repository.upsertConnected({
      accountEmail: "zone@example.com",
      googleSubject: "google-subject",
      refreshToken: "calendar-refresh-token",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      role: "operational_calendar",
      operationalCalendarId: "zone@example.com",
      now: new Date("2026-08-22T18:05:00.000Z"),
    });

    const calendarInsert = harness.calls.find((call) =>
      call.text.includes("INSERT INTO google_workspace_connections"),
    );
    expect(calendarInsert?.text).toContain("ON CONFLICT (account_email, role)");
    expect(calendarInsert?.text).not.toContain("role = 'workspace'");
  });

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

  it("keeps read access but requires reauthorization before Gmail label changes", async () => {
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
      scopes: legacyReadScopes,
      now: new Date("2026-08-22T18:00:00.000Z"),
    });

    await expect(repository.getCurrent()).resolves.toMatchObject({
      status: "reauthorization_required",
      lastErrorCode: "GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE_REQUIRED",
    });
    await expect(repository.createReadClient()).resolves.toBe(fakeClient);
    await expect(repository.createGmailLabelMutationClient()).rejects.toThrow(
      "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    );
  });

  it("returns the narrow Gmail label mutation client when modify is granted", async () => {
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

    const result = await repository.createGmailLabelMutationClient();
    expect(result?.connectionId).toBe("connection-id");
    expect(Object.keys(result?.client ?? {}).sort()).toEqual([
      "createLabel",
      "deleteLabel",
      "getThreadLabelIds",
      "listLabels",
      "modifyMessageLabels",
      "modifyThreadLabels",
      "renameLabel",
    ]);
  });

  it("persists reconnect-required state when a Gmail label operation loses authorization", async () => {
    const harness = repositoryHarness();
    const unauthorized = Object.assign(
      new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"),
      { code: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" },
    );
    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
      environment,
      createClient: () => ({
        ...fakeClient,
        modifyThreadLabels: async () => { throw unauthorized; },
      }),
    });
    await repository.upsertConnected({
      accountEmail: "zone@example.com",
      googleSubject: null,
      refreshToken: "stored-refresh-token",
      scopes: [...GOOGLE_WORKSPACE_READ_SCOPES],
      now: new Date("2026-08-22T18:00:00.000Z"),
    });

    const result = await repository.createGmailLabelMutationClient();
    await expect(result?.client.modifyThreadLabels({
      threadId: "thread-1",
      addLabelIds: ["Label_1"],
      removeLabelIds: ["INBOX"],
    })).rejects.toThrow("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");

    expect(harness.row.status).toBe("reauthorization_required");
    expect(harness.row.last_error_code).toBe(
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

  it("returns only the narrow Drive backup client when drive.file is granted", async () => {
    const harness = repositoryHarness();
    const repository = new PostgresGoogleConnectionRepository({
      pool: harness.pool,
      environment,
      createClient: () => ({
        ...fakeClient,
        driveBackup: {
          findChild: async () => null,
          createFolder: async (_parentId, name) => ({
            id: "folder-id",
            name,
            mimeType: "application/vnd.google-apps.folder",
            parents: ["root-id"],
            webViewLink: null,
            md5Checksum: null,
          }),
          createFile: async (input) => ({
            id: "file-id",
            name: input.name,
            mimeType: input.mimeType,
            parents: [input.parentId],
            webViewLink: null,
            md5Checksum: null,
          }),
          updateFile: async (input) => ({
            id: input.fileId,
            name: input.name ?? "file",
            mimeType: input.mimeType ?? "application/octet-stream",
            parents: input.parentId ? [input.parentId] : [],
            webViewLink: null,
            md5Checksum: null,
          }),
          getFile: async (id) => ({
            id,
            name: "file",
            mimeType: "application/pdf",
            parents: ["root-id"],
            webViewLink: null,
            md5Checksum: null,
          }),
        },
      }),
    });
    await repository.upsertConnected({
      accountEmail: "zone@example.com",
      googleSubject: null,
      refreshToken: "stored-refresh-token",
      scopes: [...GOOGLE_WORKSPACE_READ_SCOPES],
      now: new Date("2026-09-09T14:00:00.000Z"),
    });

    const result = await repository.createDriveBackupClient();

    expect(result?.connectionId).toBe("connection-id");
    expect(Object.keys(result?.client ?? {}).sort()).toEqual([
      "createFile",
      "createFolder",
      "findChild",
      "getFile",
      "updateFile",
    ]);
  });

  it("requires reconnect before Drive backup when drive.file is missing", async () => {
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
      scopes: GOOGLE_WORKSPACE_READ_SCOPES.filter(
        (scope) => scope !== GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE,
      ),
      now: new Date("2026-09-09T14:00:00.000Z"),
    });

    await expect(repository.getCurrent()).resolves.toMatchObject({
      status: "reauthorization_required",
      lastErrorCode: "GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE_REQUIRED",
    });
    await expect(repository.createDriveBackupClient()).rejects.toThrow(
      "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    );
  });

});


