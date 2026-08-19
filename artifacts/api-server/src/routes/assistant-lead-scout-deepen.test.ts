import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAssistantLeadScoutRouter } from "./assistant-lead-scout";

const runId = "30000000-0000-4000-8000-000000000001";
const candidateId = "40000000-0000-4000-8000-000000000001";
const run = {
  id: runId,
  originalQuestion: "find events",
  criteria: null,
  criteriaSummary: null,
  status: "running",
  stage: "candidate_enrichment",
  progress: { label: "Researching one prospect deeper", sourcesChecked: 1, candidatesFound: 1, candidatesEnriched: 0, candidatesCompared: 1 },
  crmMatches: [], candidates: [], sources: [],
  startedAt: "2026-08-19T18:00:00.000Z", completedAt: null,
  createdAt: "2026-08-19T18:00:00.000Z", updatedAt: "2026-08-19T18:00:00.000Z", failureMessage: null,
};

function appWith(service: any, actor = "owner-a") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).userId = actor; next(); });
  app.use(createAssistantLeadScoutRouter(service));
  return app;
}

describe("Lead Scout Research deeper route", () => {
  it("queues only the requested actor-owned candidate", async () => {
    const service = {
      deepenCandidate: vi.fn(async () => run),
      createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(),
      startWeb: vi.fn(), stopWeb: vi.fn(), continueWeb: vi.fn(),
    };
    const response = await request(appWith(service))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/deepen`)
      .send({})
      .expect(200);

    expect(service.deepenCandidate).toHaveBeenCalledWith({ actorId: "owner-a", runId, candidateId });
    expect(response.body.run.stage).toBe("candidate_enrichment");
  });

  it("returns conflict when the candidate is dismissed, saved, or otherwise not eligible", async () => {
    const service = {
      deepenCandidate: vi.fn(async () => { throw new Error("LEAD_SCOUT_CANDIDATE_NOT_DEEPENABLE"); }),
      createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(),
      startWeb: vi.fn(), stopWeb: vi.fn(), continueWeb: vi.fn(),
    };
    await request(appWith(service))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/deepen`)
      .send({})
      .expect(409);
  });
});
