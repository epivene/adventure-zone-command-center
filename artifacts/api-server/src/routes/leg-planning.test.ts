import express from "express";
import request from "supertest";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createLegPlanningRouter } from "./leg-planning";
import { requireOwnerMiddleware, issueToken } from "../lib/auth";
import { createRequireBossMiddleware } from "../features/boss/boss-middleware";
import { issueBossToken } from "../features/boss/boss-auth";
import { createRequireLegManagerMiddleware } from "../features/leg-manager/leg-manager-middleware";
import { issueLegManagerToken } from "../features/leg-manager/leg-manager-auth";
import { PlanningError } from "../features/leg-planning/planning-repository";
import { ids, draft } from "../features/leg-planning/planning-fixtures";
let app: ReturnType<typeof express>, service: any, enabledBoss: boolean;
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "local-planning-test-secret");
  vi.stubEnv("LEG_PLANNING_ENABLED", "true");
  enabledBoss = true;
  service = {
    get: vi.fn(async (_id, actor) => ({ actor })),
    saveDraft: vi.fn(async () => ({ receiptId: ids.booking })),
    commitPlans: vi.fn(async () => ({})),
    catalog: vi.fn(async () => ({ enabled: true })),
    saveDaveAuthority: vi.fn(async () => ({})),
  };
  app = express();
  app.use(express.json());
  app.use(
    createLegPlanningRouter({
      service,
      requireOwner: requireOwnerMiddleware,
      requireBoss: createRequireBossMiddleware({
        getActiveSession: async () =>
          enabledBoss
            ? {
                id: ids.boss,
                role: "boss",
                displayName: "Fixture Dave",
                sessionVersion: 3,
                studioOfficeAccountId: null,
              }
            : null,
      } as never),
      requireManager: createRequireLegManagerMiddleware({
        getActiveAccess: async () => ({
          legId: ids.leg,
          sessionVersion: 4,
          managerName: "Fixture manager",
        }),
      }),
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());
const token = (role: "owner" | "boss" | "manager") =>
  role === "owner"
    ? issueToken()!.token
    : role === "boss"
      ? issueBossToken({ accountId: ids.boss, sessionVersion: 3 })!.token
      : issueLegManagerToken({ legId: ids.leg, sessionVersion: 4 })!.token;
it.each(["owner", "boss", "manager"] as const)(
  "uses verified %s middleware identity and no-store responses",
  async (role) => {
    const prefix = role === "owner" ? "" : `/${role}`;
    expect(
      (
        await request(app).get(
          `${prefix}/bookings/${ids.booking}/operating-plan`,
        )
      ).status,
    ).toBe(401);
    const response = await request(app)
      .get(`${prefix}/bookings/${ids.booking}/operating-plan`)
      .auth(token(role), { type: "bearer" });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.actor.kind).toBe(role);
    if (role !== "owner")
      expect(response.body.actor.sessionVersion).toBe(role === "boss" ? 3 : 4);
  },
);
it("rejects disabled boss access and keeps Dave binding owner-only", async () => {
  enabledBoss = false;
  expect(
    (
      await request(app)
        .get(`/boss/bookings/${ids.booking}/operating-plan`)
        .auth(token("boss"), { type: "bearer" })
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .patch("/boss/leg-planning/dave-authority")
        .auth(token("boss"), { type: "bearer" })
    ).status,
  ).toBe(404);
});
it("rejects malformed bodies, forged actor fields and path/payload identity mismatch", async () => {
  const send = (body: any) =>
    request(app)
      .patch(`/bookings/${ids.booking}/operating-plan`)
      .auth(token("owner"), { type: "bearer" })
      .send(body);
  expect(
    (
      await send({
        payload: draft(),
        expectedRevision: null,
        requestKey: "x",
        approvedBy: "Dave",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await send({
        payload: draft({ bookingId: ids.otherBooking }),
        expectedRevision: null,
        requestKey: "x",
      })
    ).status,
  ).toBe(400);
  expect(service.saveDraft).not.toHaveBeenCalled();
});
it.each([403, 409, 422])(
  "returns structured %i errors without unrelated data",
  async (status) => {
    service.get.mockRejectedValue(
      new PlanningError(status, "TEST_CODE", "Private other-leg roster"),
    );
    const response = await request(app)
      .get(`/manager/bookings/${ids.booking}/operating-plan`)
      .auth(token("manager"), { type: "bearer" });
    expect(response.status).toBe(status);
    expect(response.body.code).toBe("TEST_CODE");
    expect(JSON.stringify(response.body)).not.toContain(
      "Private other-leg roster",
    );
  },
);
it("fails closed when planning is disabled or schema reads fail", async () => {
  vi.stubEnv("LEG_PLANNING_ENABLED", "false");
  expect(
    (
      await request(app)
        .get(`/bookings/${ids.booking}/operating-plan`)
        .auth(token("owner"), { type: "bearer" })
    ).status,
  ).toBe(404);
  vi.stubEnv("LEG_PLANNING_ENABLED", "true");
  service.get.mockRejectedValue(new Error("missing schema"));
  expect(
    (
      await request(app)
        .get(`/bookings/${ids.booking}/operating-plan`)
        .auth(token("owner"), { type: "bearer" })
    ).status,
  ).toBe(503);
});
