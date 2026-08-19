import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAssistantLeadScoutRouter } from "./assistant-lead-scout";

const runId = "30000000-0000-4000-8000-000000000001";
const baseRun = {
  id: runId,
  originalQuestion: "Find events between Montana and Utah in September 2026",
  criteria: null,
  criteriaSummary: null,
  status: "running",
  stage: "source_discovery",
  progress: { label: "Finding public event sources", sourcesChecked: 0, candidatesFound: 0, candidatesEnriched: 0, candidatesCompared: 0 },
  crmMatches: [], candidates: [], sources: [],
  startedAt: "2026-08-19T18:00:00.000Z", completedAt: null,
  createdAt: "2026-08-19T18:00:00.000Z", updatedAt: "2026-08-19T18:00:00.000Z", failureMessage: null,
};

function appWith(service: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).userId = "owner-1"; next(); });
  app.use(createAssistantLeadScoutRouter(service));
  return app;
}

describe("Lead Scout run controls", () => {
  it("starts the actor's CRM-ready run", async () => {
    const service = {
      startWeb: vi.fn(async () => ({ ...baseRun, status: "running", stage: "source_discovery" })),
      stopWeb: vi.fn(), continueWeb: vi.fn(), createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(),
    };
    const response = await request(appWith(service)).post(`/assistant/lead-scout/runs/${runId}/start`).send({}).expect(200);
    expect(service.startWeb).toHaveBeenCalledWith({ actorId: "owner-1", runId });
    expect(response.body.run.status).toBe("running");
  });

  it("requests stop and returns the durable stopping state", async () => {
    const service = {
      startWeb: vi.fn(),
      stopWeb: vi.fn(async () => ({ ...baseRun, status: "stopping", progress: { ...baseRun.progress, label: "Stopping…" } })),
      continueWeb: vi.fn(), createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(),
    };
    const response = await request(appWith(service)).post(`/assistant/lead-scout/runs/${runId}/stop`).send({}).expect(200);
    expect(response.body.run.status).toBe("stopping");
    expect(service.stopWeb).toHaveBeenCalledWith({ actorId: "owner-1", runId });
  });

  it("continues only a stopped actor-owned run", async () => {
    const service = {
      startWeb: vi.fn(), stopWeb: vi.fn(),
      continueWeb: vi.fn(async () => ({ ...baseRun, status: "running", stage: "candidate_discovery" })),
      createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(),
    };
    const response = await request(appWith(service)).post(`/assistant/lead-scout/runs/${runId}/continue`).send({}).expect(200);
    expect(response.body.run.status).toBe("running");
    expect(service.continueWeb).toHaveBeenCalledWith({ actorId: "owner-1", runId });
  });

  it("returns conflict for an invalid durable transition", async () => {
    const service = {
      startWeb: vi.fn(async () => { throw new Error("LEAD_SCOUT_INVALID_STATE"); }),
      stopWeb: vi.fn(), continueWeb: vi.fn(), createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(),
    };
    await request(appWith(service)).post(`/assistant/lead-scout/runs/${runId}/start`).send({}).expect(409);
  });
});
