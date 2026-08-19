import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAssistantLeadScoutRouter } from "./assistant-lead-scout";

const runId = "30000000-0000-4000-8000-000000000001";
const candidateId = "40000000-0000-4000-8000-000000000001";
const dismissedRun = {
  id: runId,
  originalQuestion: "find events",
  criteria: null,
  criteriaSummary: null,
  status: "complete",
  stage: "complete",
  progress: { label: "Search complete", sourcesChecked: 1, candidatesFound: 1, candidatesEnriched: 1, candidatesCompared: 1 },
  crmMatches: [], candidates: [{ id: candidateId, reviewStatus: "dismissed" }], sources: [],
  startedAt: "2026-08-19T18:00:00.000Z", completedAt: "2026-08-19T18:10:00.000Z",
  createdAt: "2026-08-19T18:00:00.000Z", updatedAt: "2026-08-19T18:10:00.000Z", failureMessage: null,
};

function appWith(service: any, actor = "owner-a") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).userId = actor; next(); });
  app.use(createAssistantLeadScoutRouter(service));
  return app;
}

describe("Lead Scout Not a fit route", () => {
  it("persists the actor's candidate review and returns the updated run", async () => {
    const service = {
      dismissCandidate: vi.fn(async () => dismissedRun),
      deepenCandidate: vi.fn(), createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(),
      startWeb: vi.fn(), stopWeb: vi.fn(), continueWeb: vi.fn(),
    };
    const response = await request(appWith(service))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/dismiss`)
      .send({})
      .expect(200);

    expect(service.dismissCandidate).toHaveBeenCalledWith({ actorId: "owner-a", runId, candidateId });
    expect(response.body.run.candidates[0].reviewStatus).toBe("dismissed");
  });

  it("requires the active Scout to be stopped before dismissing", async () => {
    const service = {
      dismissCandidate: vi.fn(async () => { throw new Error("LEAD_SCOUT_CANDIDATE_NOT_DISMISSIBLE"); }),
      deepenCandidate: vi.fn(), createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(),
      startWeb: vi.fn(), stopWeb: vi.fn(), continueWeb: vi.fn(),
    };
    const response = await request(appWith(service))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/dismiss`)
      .send({})
      .expect(409);

    expect(response.body.error).toMatch(/stop the active scout/i);
  });
});
