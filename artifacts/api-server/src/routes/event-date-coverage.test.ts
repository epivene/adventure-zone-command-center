import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"; });
import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import { createEventDateCoverageRouter } from "./event-date-coverage";

const coveragePage = { records: [], summary: { booked: 1, confirmed: 2, expected: 3, missing: 4, stale: 5, needs_review: 6 }, total: 0, page: 1, pageSize: 25, pageCount: 1 };

describe("event date coverage routes", () => {
  beforeEach(() => { process.env.SESSION_SECRET = "coverage-test-secret"; });
  function setup() {
    const dependencies = {
      coverage: { list: vi.fn(async () => coveragePage) },
      jobs: {
        createRun: vi.fn(async () => ({ id: "run-1", batchSize: 25 })),
        getRun: vi.fn(async () => ({ id: "run-1", status: "queued", items: [] })),
        retryItem: vi.fn(async () => ({ id: "item-1", status: "queued" })),
        listAttemptedOrganizationIds: vi.fn(async () => [] as string[]),
      },
      facts: { listFacts: vi.fn(async () => []), review: vi.fn(async () => ({ id: "fact-1" })) },
      canStartRun: vi.fn(() => true),
    };
    const app = express(); app.use(express.json());
    app.use(createEventDateCoverageRouter(dependencies as never, requireOwnerMiddleware));
    return { app, dependencies, token: issueToken()!.token };
  }

  it("requires owner authorization", async () => {
    const { app } = setup();
    expect((await request(app).get("/event-date-coverage/summary")).status).toBe(401);
  });

  it("serves summary, list, detail, and run state", async () => {
    const { app, token } = setup();
    expect((await request(app).get("/event-date-coverage/summary").set("Authorization", `Bearer ${token}`)).body).toEqual(coveragePage.summary);
    expect((await request(app).get("/event-date-coverage/profiles?status=missing&page=1").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).get("/event-date-coverage/profiles/org-1").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).get("/event-date-coverage/runs/run-1").set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it("validates run input and defaults to a 25-profile batch", async () => {
    const { app, token, dependencies } = setup();
    expect((await request(app).post("/event-date-coverage/runs").set("Authorization", `Bearer ${token}`).send({ batchSize: 0 })).status).toBe(400);
    expect((await request(app).post("/event-date-coverage/runs").set("Authorization", `Bearer ${token}`).send({ organizationIds: ["00000000-0000-4000-8000-000000000001"] })).status).toBe(201);
    expect(dependencies.jobs.createRun).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 25 }));
  });

  it("skips previously attempted profiles when starting the next batch", async () => {
    const { app, token, dependencies } = setup();
    const priorId = "00000000-0000-4000-8000-000000000001";
    const nextId = "00000000-0000-4000-8000-000000000002";
    dependencies.coverage.list.mockResolvedValue({
      ...coveragePage,
      records: [{ organizationId: priorId }, { organizationId: nextId }],
    } as never);
    dependencies.jobs.listAttemptedOrganizationIds.mockResolvedValue([priorId]);

    expect((await request(app).post("/event-date-coverage/runs").set("Authorization", `Bearer ${token}`).send({})).status).toBe(201);
    expect(dependencies.jobs.createRun).toHaveBeenCalledWith(expect.objectContaining({ organizationIds: [nextId] }));
    dependencies.jobs.listAttemptedOrganizationIds.mockResolvedValue([priorId, nextId]);
    expect((await request(app).post("/event-date-coverage/runs").set("Authorization", `Bearer ${token}`).send({})).status).toBe(409);
  });

  it("supports retry and review actions and reports rate limits", async () => {
    const { app, token, dependencies } = setup();
    expect((await request(app).post("/event-date-coverage/items/item-1/retry").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).post("/event-date-coverage/facts/fact-1/review").set("Authorization", `Bearer ${token}`).send({ decision: "dismiss" })).status).toBe(200);
    expect((await request(app).post("/event-date-coverage/facts/fact-1/review").set("Authorization", `Bearer ${token}`).send({ decision: "wrong" })).status).toBe(400);
    dependencies.canStartRun.mockReturnValue(false);
    expect((await request(app).post("/event-date-coverage/runs").set("Authorization", `Bearer ${token}`).send({})).status).toBe(429);
  });
});
