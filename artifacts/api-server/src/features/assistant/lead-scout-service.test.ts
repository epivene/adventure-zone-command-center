import { describe, expect, it, vi } from "vitest";

import { LeadScoutService } from "./lead-scout-service";
import type { AssistantLeadMatch, LeadDiscoveryCriteria, LeadScoutRunView } from "./lead-scout-types";

const criteria: LeadDiscoveryCriteria = {
  originalQuestion: "I need to find an event between Montana and Utah in September 2026",
  dateFrom: "2026-09-01",
  dateThrough: "2026-09-30",
  month: 9,
  year: 2026,
  regions: ["MT", "ID", "WY", "UT"],
  cities: [],
  geoMode: "corridor",
  routeId: null,
  legId: null,
  eventKeywords: [],
  fitIntent: "either",
};

const match: AssistantLeadMatch = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  bookingId: "20000000-0000-4000-8000-000000000001",
  label: "Montana Fair",
  city: "Billings",
  region: "MT",
  dateFrom: "2026-09-10",
  dateThrough: "2026-09-12",
  dateConfidence: "confirmed",
  status: "possible",
  relationshipSummary: "1 booking on record",
  reasons: ["Confirmed September date", "On requested corridor"],
  fitScore: 1150,
};

function runView(overrides: Partial<LeadScoutRunView> = {}): LeadScoutRunView {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    originalQuestion: criteria.originalQuestion,
    criteria,
    criteriaSummary: "September 1–30, 2026 · Montana-to-Utah corridor",
    status: "crm_ready",
    stage: "crm_search",
    progress: { label: "Waiting for web-search approval", sourcesChecked: 0, candidatesFound: 0, candidatesEnriched: 0, candidatesCompared: 0 },
    crmMatches: [match],
    candidates: [],
    sources: [],
    startedAt: "2026-08-19T12:00:00.000Z",
    completedAt: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    failureMessage: null,
    ...overrides,
  };
}

describe("LeadScoutService", () => {
  it("persists the run before interpreting/searching and returns crm_ready", async () => {
    const order: string[] = [];
    const repository = {
      createRun: vi.fn(async () => { order.push("create"); return runView().id; }),
      setCriteria: vi.fn(async () => { order.push("criteria"); }),
      setCrmReady: vi.fn(async () => { order.push("ready"); }),
      setFailed: vi.fn(async () => undefined),
      getRun: vi.fn(async () => runView()),
      getLatestRun: vi.fn(async () => runView()),
    };
    const crmSearch = {
      search: vi.fn(async () => { order.push("search"); return [match]; }),
    };
    const interpreter = vi.fn(() => {
      order.push("interpret");
      return { kind: "criteria" as const, criteria, summary: "September 1–30, 2026 · Montana-to-Utah corridor" };
    });
    const service = new LeadScoutService({ repository: repository as never, crmSearch, interpreter });

    const result = await service.createCrmDiscovery({ actorId: "owner-1", question: criteria.originalQuestion });

    expect(order).toEqual(["create", "interpret", "criteria", "search", "ready"]);
    expect("kind" in result ? result.kind : result.status).toBe("crm_ready");
    expect(repository.createRun).toHaveBeenCalledWith(expect.objectContaining({ actorId: "owner-1", criteria: null }));
    expect(crmSearch.search).toHaveBeenCalledWith(criteria, 10);
  });

  it("persists clarification runs but never searches CRM for ambiguous criteria", async () => {
    const repository = {
      createRun: vi.fn(async () => runView().id),
      setCriteria: vi.fn(),
      setCrmReady: vi.fn(),
      setFailed: vi.fn(),
      getRun: vi.fn(),
      getLatestRun: vi.fn(),
    };
    const crmSearch = { search: vi.fn() };
    const service = new LeadScoutService({
      repository: repository as never,
      crmSearch,
      interpreter: () => ({ kind: "needs_clarification", message: "What year?", partial: { geoMode: "corridor" } }),
    });

    const result = await service.createCrmDiscovery({ actorId: "owner-1", question: "find something this fall between Montana and Utah" });

    expect(result).toEqual({ kind: "needs_clarification", runId: runView().id, message: "What year?" });
    expect(repository.createRun).toHaveBeenCalledTimes(1);
    expect(repository.setCriteria).not.toHaveBeenCalled();
    expect(crmSearch.search).not.toHaveBeenCalled();
  });

  it("fails the persisted run when CRM search throws", async () => {
    const repository = {
      createRun: vi.fn(async () => runView().id),
      setCriteria: vi.fn(async () => undefined),
      setCrmReady: vi.fn(),
      setFailed: vi.fn(async () => undefined),
      getRun: vi.fn(),
      getLatestRun: vi.fn(),
    };
    const service = new LeadScoutService({
      repository: repository as never,
      crmSearch: { search: vi.fn(async () => { throw new Error("database unavailable"); }) },
      interpreter: () => ({ kind: "criteria", criteria, summary: "summary" }),
    });

    await expect(service.createCrmDiscovery({ actorId: "owner-1", question: criteria.originalQuestion })).rejects.toThrow("database unavailable");
    expect(repository.setFailed).toHaveBeenCalledWith(runView().id, "database unavailable");
  });

  it("enforces actor ownership when loading a run", async () => {
    const repository = {
      createRun: vi.fn(), setCriteria: vi.fn(), setCrmReady: vi.fn(), setFailed: vi.fn(), getLatestRun: vi.fn(),
      getRun: vi.fn(async ({ actorId }: { actorId: string }) => actorId === "owner-1" ? runView() : null),
    };
    const service = new LeadScoutService({ repository: repository as never, crmSearch: { search: vi.fn() } });

    await expect(service.getRun({ actorId: "owner-2", runId: runView().id })).rejects.toThrow("LEAD_SCOUT_RUN_NOT_FOUND");
    expect((await service.getRun({ actorId: "owner-1", runId: runView().id })).id).toBe(runView().id);
  });
});
