import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAssistantLeadScoutRouter } from "./assistant-lead-scout";

const run = {
  id: "30000000-0000-4000-8000-000000000001",
  originalQuestion: "Scout 200 miles around Miles City, MT",
  criteria: null,
  criteriaSummary: "August 24–September 12 · 200 miles around Miles City, MT",
  status: "crm_ready",
  stage: "crm_search",
  progress: { label: "Waiting for web-search approval", sourcesChecked: 0, candidatesFound: 0, candidatesEnriched: 0, candidatesCompared: 0 },
  crmMatches: [],
  candidates: [],
  sources: [],
  startedAt: "2026-08-25T12:00:00.000Z",
  completedAt: null,
  createdAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
  failureMessage: null,
};

function appWith(radiusService: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = "owner-1";
    next();
  });
  const baseService = {
    createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(), startWeb: vi.fn(),
    stopWeb: vi.fn(), continueWeb: vi.fn(), deepenCandidate: vi.fn(), dismissCandidate: vi.fn(), saveCandidate: vi.fn(),
  };
  app.use(createAssistantLeadScoutRouter(baseService as any, radiusService));
  return app;
}

const validRequest = {
  anchor: { kind: "manual", label: "Miles City, MT" },
  radiusMiles: 200,
  dateStart: "2026-08-24",
  dateEnd: "2026-09-12",
  categories: ["fair", "festival", "rodeo"],
  historyFilter: "hide_booked",
};

describe("Radius Scout route", () => {
  it("creates a radius-scoped Lead Scout run", async () => {
    const radiusService = { create: vi.fn(async () => run) };
    const response = await request(appWith(radiusService))
      .post("/assistant/lead-scout/radius")
      .send(validRequest)
      .expect(201);

    expect(response.body.run.id).toBe(run.id);
    expect(radiusService.create).toHaveBeenCalledWith({ actorId: "owner-1", request: validRequest });
  });

  it("rejects unsupported radii", async () => {
    const radiusService = { create: vi.fn() };
    await request(appWith(radiusService))
      .post("/assistant/lead-scout/radius")
      .send({ ...validRequest, radiusMiles: 75 })
      .expect(400);
    expect(radiusService.create).not.toHaveBeenCalled();
  });

  it("rejects an end date before the start date", async () => {
    const radiusService = { create: vi.fn() };
    const response = await request(appWith(radiusService))
      .post("/assistant/lead-scout/radius")
      .send({ ...validRequest, dateStart: "2026-09-12", dateEnd: "2026-08-24" })
      .expect(400);
    expect(response.body.error).toMatch(/end date/i);
    expect(radiusService.create).not.toHaveBeenCalled();
  });

  it("requires at least one event category", async () => {
    const radiusService = { create: vi.fn() };
    await request(appWith(radiusService))
      .post("/assistant/lead-scout/radius")
      .send({ ...validRequest, categories: [] })
      .expect(400);
    expect(radiusService.create).not.toHaveBeenCalled();
  });

  it("accepts a contextual booking anchor without browser coordinates", async () => {
    const radiusService = { create: vi.fn(async () => run) };
    await request(appWith(radiusService))
      .post("/assistant/lead-scout/radius")
      .send({
        ...validRequest,
        anchor: {
          kind: "booking",
          recordId: "20000000-0000-4000-8000-000000000001",
          label: "Miles City Fair",
          city: "Miles City",
          region: "MT",
        },
      })
      .expect(201);
    expect(radiusService.create).toHaveBeenCalledTimes(1);
  });
});