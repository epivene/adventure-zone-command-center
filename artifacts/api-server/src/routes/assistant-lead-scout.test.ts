import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAssistantLeadScoutRouter } from "./assistant-lead-scout";

function appWith(service: any, actorId = "owner-1") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = actorId;
    next();
  });
  app.use(createAssistantLeadScoutRouter(service));
  return app;
}

const run = {
  id: "30000000-0000-4000-8000-000000000001",
  originalQuestion: "I need to find an event between Montana and Utah in September 2026",
  criteria: null,
  criteriaSummary: null,
  status: "crm_ready",
  stage: "crm_search",
  progress: { label: "Waiting for web-search approval", sourcesChecked: 0, candidatesFound: 0, candidatesEnriched: 0, candidatesCompared: 0 },
  crmMatches: [],
  candidates: [],
  sources: [],
  startedAt: "2026-08-19T12:00:00.000Z",
  completedAt: null,
  createdAt: "2026-08-19T12:00:00.000Z",
  updatedAt: "2026-08-19T12:00:00.000Z",
  failureMessage: null,
};

describe("assistant Lead Scout routes", () => {
  it("creates a CRM-first discovery run for the authenticated owner", async () => {
    const service = {
      createCrmDiscovery: vi.fn(async () => run),
      getRun: vi.fn(),
      getLatestRun: vi.fn(),
    };

    const response = await request(appWith(service))
      .post("/assistant/lead-scout/runs")
      .send({ question: run.originalQuestion })
      .expect(200);

    expect(response.body.run).toEqual(run);
    expect(service.createCrmDiscovery).toHaveBeenCalledWith({ actorId: "owner-1", question: run.originalQuestion });
  });

  it("returns a persisted clarification response without pretending a run is ready", async () => {
    const service = {
      createCrmDiscovery: vi.fn(async () => ({ kind: "needs_clarification", runId: run.id, message: "What year?" })),
      getRun: vi.fn(),
      getLatestRun: vi.fn(),
    };

    const response = await request(appWith(service))
      .post("/assistant/lead-scout/runs")
      .send({ question: "find something this fall" })
      .expect(200);

    expect(response.body).toEqual({ kind: "needs_clarification", runId: run.id, message: "What year?" });
  });

  it("returns 404 when another actor cannot access a run", async () => {
    const service = {
      createCrmDiscovery: vi.fn(),
      getRun: vi.fn(async () => { throw new Error("LEAD_SCOUT_RUN_NOT_FOUND"); }),
      getLatestRun: vi.fn(),
    };

    await request(appWith(service, "owner-2"))
      .get(`/assistant/lead-scout/runs/${run.id}`)
      .expect(404);
  });

  it("loads the latest run for the authenticated actor", async () => {
    const service = {
      createCrmDiscovery: vi.fn(),
      getRun: vi.fn(),
      getLatestRun: vi.fn(async () => run),
    };

    const response = await request(appWith(service))
      .get("/assistant/lead-scout/runs/latest")
      .expect(200);

    expect(response.body.run.id).toBe(run.id);
    expect(service.getLatestRun).toHaveBeenCalledWith("owner-1");
  });

  it("rejects blank or oversized questions", async () => {
    const service = { createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn() };
    await request(appWith(service)).post("/assistant/lead-scout/runs").send({ question: "   " }).expect(400);
    await request(appWith(service)).post("/assistant/lead-scout/runs").send({ question: "x".repeat(4001) }).expect(400);
    expect(service.createCrmDiscovery).not.toHaveBeenCalled();
  });
});
