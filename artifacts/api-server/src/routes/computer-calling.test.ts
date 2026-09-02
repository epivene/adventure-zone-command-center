import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import { FixedWindowRateLimiter } from "@/features/calls/computer-calling-rate-limit";
import { createComputerCallingRouter, resolveComputerCallingSourceIp } from "./computer-calling";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const CONTACT_ID = "20000000-0000-4000-8000-000000000001";
const PHONE_ID = "30000000-0000-4000-8000-000000000001";
const SESSION_ID = "40000000-0000-4000-8000-000000000001";

function enabledConfig() {
  return {
    enabled: true as const,
    config: {
      accountSid: "AC123",
      apiKeySid: "SK123",
      apiKeySecret: "secret",
      authToken: "auth",
      twimlAppSid: "AP123",
      verifiedCallerId: "+15551234567",
      webhookBaseUrl: "https://calls.example.test",
    },
    capability: { enabled: true, reason: "available" as const, callerIdDisplay: "+15551234567" },
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const service = {
    createIntent: vi.fn().mockResolvedValue({
      sessionId: SESSION_ID,
      expiresAt: "2026-09-01T12:02:00.000Z",
    }),
    getSession: vi.fn().mockResolvedValue({
      id: SESSION_ID,
      status: "created",
      startedAt: null,
      answeredAt: null,
      endedAt: null,
      durationSeconds: null,
      errorSummary: null,
    }),
  };
  const provider = { createBrowserToken: vi.fn().mockReturnValue("opaque-browser-token") };
  const app = express();
  app.use(express.json());
  app.use(requireOwnerMiddleware);
  app.use(createComputerCallingRouter({
    service: service as any,
    providerForConfig: () => provider as any,
    getConfig: enabledConfig,
    isAssistedCallingEnabled: () => true,
    limiter: new FixedWindowRateLimiter({ limit: 10, windowMs: 5 * 60_000 }),
    clock: () => new Date("2026-09-01T12:00:00.000Z"),
    clientIp: () => "127.0.0.1",
    ...overrides,
  }));
  return { app, service, provider };
}

function ownerAuthorization(): string {
  const issued = issueToken();
  if (!issued) throw new Error("Could not issue test owner token");
  return `Bearer ${issued.token}`;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "computer-calling-route-test-secret";
});

describe("computer calling owner routes", () => {
  const renderWebProduction = {
    NODE_ENV: "production",
    RENDER_SERVICE_ID: "srv-calls-api",
    RENDER_SERVICE_TYPE: "web",
  };

  function ipRequest(headers: Record<string, string> = {}, ip = "10.0.0.5") {
    return {
      ip,
      socket: { remoteAddress: ip },
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    } as any;
  }

  it("uses Cloudflare's validated client IP only on a Render-managed web service", () => {
    expect(resolveComputerCallingSourceIp(
      ipRequest({ "cf-connecting-ip": "198.51.100.42" }),
      renderWebProduction,
    )).toBe("198.51.100.42");
  });

  it.each([
    { NODE_ENV: "production", RENDER_DATABASE_URL: "postgres://app-configured" },
    { NODE_ENV: "production", RENDER_SERVICE_ID: "", RENDER_SERVICE_TYPE: "web" },
    { NODE_ENV: "production", RENDER_SERVICE_ID: "srv-worker", RENDER_SERVICE_TYPE: "worker" },
  ])("does not trust CF-Connecting-IP without Render web-service identity", (environment) => {
    expect(resolveComputerCallingSourceIp(
      ipRequest({ "cf-connecting-ip": "198.51.100.42" }),
      environment,
    )).toBe("10.0.0.5");
  });

  it("ignores spoofed forwarded-for values on Render", () => {
    const request = {
      ip: "10.0.0.5",
      socket: { remoteAddress: "10.0.0.5" },
      get: (name: string) => ({
        "cf-connecting-ip": "198.51.100.42",
        "x-forwarded-for": "203.0.113.99, 198.51.100.42",
      })[name.toLowerCase()] ?? null,
    } as any;

    expect(resolveComputerCallingSourceIp(request, renderWebProduction)).toBe("198.51.100.42");
  });

  it.each([undefined, "not-an-ip", "198.51.100.42, 203.0.113.4"])(
    "falls back safely when Render's CF-Connecting-IP is %s",
    (connectingIp) => {
      expect(resolveComputerCallingSourceIp(
        ipRequest(connectingIp ? { "cf-connecting-ip": connectingIp } : {}),
        renderWebProduction,
      )).toBe("10.0.0.5");
    },
  );

  it("uses the socket IP outside Render production", () => {
    expect(resolveComputerCallingSourceIp(
      ipRequest({ "cf-connecting-ip": "198.51.100.42" }),
      { NODE_ENV: "test" },
    )).toBe("10.0.0.5");
  });

  it("gives distinct Render Cloudflare clients distinct owner token buckets", async () => {
    const { app } = harness({
      clientIp: (req: any) => resolveComputerCallingSourceIp(req, renderWebProduction),
      limiter: new FixedWindowRateLimiter({ limit: 1, windowMs: 5 * 60_000 }),
    });
    const auth = ownerAuthorization();

    await request(app).post("/calls/computer/token")
      .set("Authorization", auth)
      .set("CF-Connecting-IP", "198.51.100.42")
      .set("X-Forwarded-For", "203.0.113.200")
      .expect(200);
    await request(app).post("/calls/computer/token")
      .set("Authorization", auth)
      .set("CF-Connecting-IP", "198.51.100.43")
      .set("X-Forwarded-For", "203.0.113.201")
      .expect(200);
    await request(app).post("/calls/computer/token")
      .set("Authorization", auth)
      .set("CF-Connecting-IP", "198.51.100.42")
      .set("X-Forwarded-For", "203.0.113.202")
      .expect(429, { error: "rate_limited" });
  });

  it("requires owner authentication", async () => {
    await request(harness().app).post("/calls/computer/token").expect(401);
  });

  it("issues only a fixed 300-second token without caching it", async () => {
    const { app, provider } = harness();

    const response = await request(app)
      .post("/calls/computer/token")
      .set("Authorization", ownerAuthorization())
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      token: "opaque-browser-token",
      expiresAt: "2026-09-01T12:05:00.000Z",
    });
    expect(provider.createBrowserToken).toHaveBeenCalledWith({ identity: "owner", ttlSeconds: 300 });
  });

  it("rejects a browser-supplied destination", async () => {
    const { app, service } = harness();

    await request(app)
      .post("/calls/computer/intents")
      .set("Authorization", ownerAuthorization())
      .send({ organizationId: ORGANIZATION_ID, contactId: CONTACT_ID, phoneId: PHONE_ID, destination: "+15551234567" })
      .expect(400);

    expect(service.createIntent).not.toHaveBeenCalled();
  });

  it("creates an intent using only opaque stored-record identifiers", async () => {
    const { app, service } = harness();

    const response = await request(app)
      .post("/calls/computer/intents")
      .set("Authorization", ownerAuthorization())
      .send({ organizationId: ORGANIZATION_ID, contactId: CONTACT_ID, phoneId: PHONE_ID })
      .expect(201);

    expect(response.body).toEqual({ sessionId: SESSION_ID, expiresAt: "2026-09-01T12:02:00.000Z" });
    expect(service.createIntent).toHaveBeenCalledWith({
      ownerId: "owner",
      organizationId: ORGANIZATION_ID,
      contactId: CONTACT_ID,
      phoneId: PHONE_ID,
      now: new Date("2026-09-01T12:00:00.000Z"),
    });
  });

  it("returns stable feature and rate-limit errors", async () => {
    const disabled = { enabled: false as const, capability: { enabled: false, reason: "disabled" as const, callerIdDisplay: null } };
    const { app } = harness({ getConfig: () => disabled });
    const auth = ownerAuthorization();

    await request(app).post("/calls/computer/token").set("Authorization", auth)
      .expect(503, { error: "feature_disabled" });

    const limited = harness({ limiter: new FixedWindowRateLimiter({ limit: 1, windowMs: 5 * 60_000 }) });
    await request(limited.app).post("/calls/computer/token").set("Authorization", auth).expect(200);
    await request(limited.app).post("/calls/computer/token").set("Authorization", auth)
      .expect(429, { error: "rate_limited" });
  });

  it("returns a session only through the authenticated owner scope", async () => {
    const { app, service } = harness();

    const response = await request(app)
      .get(`/calls/computer/sessions/${SESSION_ID}`)
      .set("Authorization", ownerAuthorization())
      .expect(200);

    expect(response.body).toMatchObject({ id: SESSION_ID, status: "created" });
    expect(service.getSession).toHaveBeenCalledWith({ ownerId: "owner", sessionId: SESSION_ID });
  });
});
