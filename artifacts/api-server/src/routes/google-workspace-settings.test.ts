import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import type { GoogleWorkspaceEnvironment } from "@/features/google-workspace/google-workspace-env";
import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import { createGoogleWorkspaceSettingsRouter } from "./google-workspace-settings";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 5)),
};

const preview = {
  labels: [
    { id: "shows", name: "Shows", rootId: "shows", rootName: "Shows" },
  ],
  calendars: [
    { id: "az", summary: "Adventure Zone Calendar", primary: false },
  ],
  missingLabelRoots: [],
  missingCalendars: [],
  excludedLabelCount: 3,
  excludedCalendarCount: 1,
};

function dependencies(options?: { configured?: boolean }) {
  const createState = vi.fn(async () => undefined);
  const disconnect = vi.fn(async () => undefined);
  const save = vi.fn(async () => ({
    labels: preview.labels,
    calendars: preview.calendars,
  }));
  const client: GoogleWorkspaceReadClient = {
    authorizationUrl: ({ state }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
  };
  return {
    createState,
    disconnect,
    save,
    deps: {
      getEnvironment: () =>
        options?.configured === false
          ? { configured: false as const }
          : { configured: true as const, value: environment },
      stateRepository: {
        create: createState,
        consume: async () => null,
        deleteExpired: async () => 0,
      },
      connectionRepository: {
        getCurrent: vi.fn(async () => ({
          id: "connection-id",
          email: "zone@example.com",
          status: "connected" as const,
          grantedScopes: ["scope-a"],
          connectedAt: "2026-08-22T18:00:00.000Z",
          lastVerifiedAt: "2026-08-22T18:00:00.000Z",
          lastErrorCode: null,
        })),
        disconnect,
      },
      scopeService: {
        preview: vi.fn(async () => preview),
        getSaved: vi.fn(async () => ({
          labels: preview.labels,
          calendars: preview.calendars,
        })),
        save,
      },
      createClient: vi.fn(() => client),
      randomState: () => "fixed-oauth-state",
      now: () => new Date("2026-08-22T18:00:00.000Z"),
    },
  };
}

function ownerApp(deps: ReturnType<typeof dependencies>["deps"]) {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-long-enough");
  const app = express();
  app.use(express.json());
  app.use(requireOwnerMiddleware);
  app.use(createGoogleWorkspaceSettingsRouter(deps));
  const issued = issueToken();
  if (!issued) throw new Error("Owner token was not issued");
  return { app, token: issued.token };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google Workspace owner settings routes", () => {
  it("returns connection and saved scope without credentials", async () => {
    const harness = dependencies();
    const { app, token } = ownerApp(harness.deps);

    const response = await request(app)
      .get("/google-workspace/settings")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      configured: true,
      connection: {
        id: "connection-id",
        email: "zone@example.com",
        status: "connected",
        grantedScopes: ["scope-a"],
        connectedAt: "2026-08-22T18:00:00.000Z",
        lastVerifiedAt: "2026-08-22T18:00:00.000Z",
        lastErrorCode: null,
      },
      labels: preview.labels,
      calendars: preview.calendars,
    });
    expect(response.body).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(response.body)).not.toContain("client-secret");
  });

  it("reports an unconfigured connection without crashing the app", async () => {
    const harness = dependencies({ configured: false });
    harness.deps.connectionRepository.getCurrent.mockResolvedValue(null);
    harness.deps.scopeService.getSaved.mockResolvedValue({ labels: [], calendars: [] });
    const { app, token } = ownerApp(harness.deps);

    await request(app)
      .get("/google-workspace/settings")
      .set("authorization", `Bearer ${token}`)
      .expect(200, {
        configured: false,
        connection: null,
        labels: [],
        calendars: [],
      });
  });

  it("creates a ten-minute single-use state and returns the authorization URL", async () => {
    const harness = dependencies();
    const { app, token } = ownerApp(harness.deps);

    const response = await request(app)
      .post("/google-workspace/oauth/start")
      .set("authorization", `Bearer ${token}`)
      .send({})
      .expect(200);

    expect(harness.createState).toHaveBeenCalledWith({
      state: "fixed-oauth-state",
      returnPath: "/settings/google-workspace",
      expiresAt: new Date("2026-08-22T18:10:00.000Z"),
    });
    expect(response.body).toEqual({
      authorizationUrl:
        "https://accounts.google.com/o/oauth2/v2/auth?state=fixed-oauth-state",
    });
  });

  it("returns exact business scope preview", async () => {
    const harness = dependencies();
    const { app, token } = ownerApp(harness.deps);

    await request(app)
      .post("/google-workspace/scope/preview")
      .set("authorization", `Bearer ${token}`)
      .send({})
      .expect(200, preview);
  });

  it("saves only strict label and calendar ID arrays", async () => {
    const harness = dependencies();
    const { app, token } = ownerApp(harness.deps);

    const response = await request(app)
      .put("/google-workspace/scope")
      .set("authorization", `Bearer ${token}`)
      .send({ labelIds: ["shows"], calendarIds: ["az"] })
      .expect(200);

    expect(harness.save).toHaveBeenCalledWith({
      labelIds: ["shows"],
      calendarIds: ["az"],
      actorKind: "owner",
      actorId: "owner",
      now: new Date("2026-08-22T18:00:00.000Z"),
    });
    expect(response.body).toEqual({
      labels: preview.labels,
      calendars: preview.calendars,
    });

    await request(app)
      .put("/google-workspace/scope")
      .set("authorization", `Bearer ${token}`)
      .send({ labelIds: ["shows"], calendarIds: ["az"], personal: true })
      .expect(400);
  });

  it("disconnects only after an explicit owner request", async () => {
    const harness = dependencies();
    const { app, token } = ownerApp(harness.deps);

    await request(app)
      .post("/google-workspace/disconnect")
      .set("authorization", `Bearer ${token}`)
      .send({})
      .expect(200, { ok: true });

    expect(harness.disconnect).toHaveBeenCalledWith(
      new Date("2026-08-22T18:00:00.000Z"),
    );
  });

  it("rejects Office, leg-manager, and missing bearer tokens", async () => {
    const harness = dependencies();
    const { app } = ownerApp(harness.deps);

    await request(app).get("/google-workspace/settings").expect(401);
    await request(app)
      .get("/google-workspace/settings")
      .set("authorization", "Bearer office.fake.token")
      .expect(401);
    await request(app)
      .get("/google-workspace/settings")
      .set("authorization", "Bearer leg.fake.token")
      .expect(401);
  });

  it("mounts the public callback before owner auth and settings after it", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/routes/index.ts"), "utf8");
    const callbackAt = source.indexOf("googleWorkspaceOAuthCallbackRouter");
    const ownerAt = source.indexOf("router.use(requireOwnerMiddleware)");
    const settingsMountAt = source.lastIndexOf("googleWorkspaceSettingsRouter");

    expect(callbackAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(callbackAt);
    expect(settingsMountAt).toBeGreaterThan(ownerAt);
  });
});
