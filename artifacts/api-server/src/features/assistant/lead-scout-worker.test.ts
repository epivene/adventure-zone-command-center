import { describe, expect, it, vi } from "vitest";

import { LeadScoutWorker } from "./lead-scout-worker";
import type { LeadDiscoveryCriteria, LeadScoutRunView, LeadScoutWorkClaim } from "./lead-scout-types";

const criteria: LeadDiscoveryCriteria = {
  originalQuestion: "Find events between Montana and Utah in September 2026",
  dateFrom: "2026-09-01", dateThrough: "2026-09-30", month: 9, year: 2026,
  regions: ["MT", "ID", "WY", "UT"], cities: [], geoMode: "corridor",
  routeId: null, legId: null, eventKeywords: ["festival"], fitIntent: "either",
};

function claim(stage: LeadScoutWorkClaim["stage"]): LeadScoutWorkClaim {
  return {
    runId: "run-1", actorId: "user-a", criteria, stage, status: "running",
    workerId: "worker-a", leaseExpiresAt: "2026-08-19T18:01:00.000Z",
  };
}

function runView(overrides: Partial<LeadScoutRunView> = {}): LeadScoutRunView {
  return {
    id: "run-1", originalQuestion: criteria.originalQuestion, criteria,
    criteriaSummary: "September 2026 · MT to UT", status: "running", stage: "source_discovery",
    progress: { label: null, sourcesChecked: 0, candidatesFound: 0, candidatesEnriched: 0, candidatesCompared: 0 },
    crmMatches: [], candidates: [], sources: [], startedAt: "2026-08-19T18:00:00.000Z",
    completedAt: null, createdAt: "2026-08-19T18:00:00.000Z", updatedAt: "2026-08-19T18:00:00.000Z",
    failureMessage: null, ...overrides,
  };
}

function repository(stage: LeadScoutWorkClaim["stage"], view = runView({ stage })) {
  return {
    claimRunnable: vi.fn(async () => claim(stage)),
    getRun: vi.fn(async () => view),
    isCancellationRequested: vi.fn(async () => false),
    upsertSources: vi.fn(async () => undefined),
    upsertCandidates: vi.fn(async () => undefined),
    updateProgress: vi.fn(async () => undefined),
    setCandidateCrmMatch: vi.fn(async () => undefined),
    setCandidateFit: vi.fn(async () => undefined),
    stopRun: vi.fn(async () => undefined),
    completeRun: vi.fn(async () => undefined),
    failRun: vi.fn(async () => undefined),
  };
}

const source = {
  url: "https://visitidaho.org/events", title: "Idaho events", publisher: "Visit Idaho" as string | null,
  category: "tourism_chamber" as const, retrievedAt: "2026-08-19T18:00:00.000Z", excerpt: "events",
};
const candidate = {
  name: "Silver Valley Days", city: "Kellogg", region: "ID", venue: "Downtown",
  startsAt: "2026-09-11", endsAt: "2026-09-13", website: "https://example.org/silver",
  eventType: "community festival", rationale: "Family event",
};

describe("LeadScoutWorker", () => {
  it("persists discovered sources before advancing to candidate discovery", async () => {
    const repo = repository("source_discovery");
    const provider = { discoverSources: vi.fn(async () => [source]), discoverCandidates: vi.fn() };
    const worker = new LeadScoutWorker({ repository: repo as never, provider: provider as never, matcher: vi.fn() });

    expect(await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") })).toEqual({ kind: "progress" });
    expect(repo.upsertSources).toHaveBeenCalledWith("run-1", [source]);
    expect(repo.updateProgress).toHaveBeenCalledWith("run-1", expect.objectContaining({ stage: "candidate_discovery", sourcesChecked: 1 }));
  });

  it("persists candidate discoveries before CRM comparison", async () => {
    const repo = repository("candidate_discovery", runView({
      stage: "candidate_discovery",
      sources: [{ id: "s1", url: source.url, title: source.title, publisher: source.publisher, category: source.category, retrievedAt: source.retrievedAt }],
    }));
    const provider = { discoverSources: vi.fn(), discoverCandidates: vi.fn(async () => [candidate]) };
    const worker = new LeadScoutWorker({ repository: repo as never, provider: provider as never, matcher: vi.fn() });
    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });
    expect(repo.upsertCandidates).toHaveBeenCalledWith("run-1", [candidate]);
    expect(repo.updateProgress).toHaveBeenCalledWith("run-1", expect.objectContaining({ stage: "crm_compare", candidatesFound: 1 }));
  });

  it("compares one candidate locally against Command Center per work unit", async () => {
    const view = runView({
      stage: "crm_compare",
      candidates: [{
        id: "c1", name: candidate.name, city: candidate.city, region: candidate.region, venue: candidate.venue,
        startsAt: candidate.startsAt, endsAt: candidate.endsAt, organizerName: null, organizerEmail: null,
        organizerPhone: null, website: candidate.website, eventType: candidate.eventType, recurrenceSummary: null,
        attendanceSummary: null, vendorSummary: null, applicationDeadline: null, fitScore: null,
        fitRationale: candidate.rationale, crmMatchStatus: "new_prospect", matchedOrganizationId: null,
        matchedBookingId: null, reviewStatus: "unreviewed", savedOrganizationId: null, savedBookingId: null, facts: [],
      }],
    });
    const repo = repository("crm_compare", view);
    const matcher = vi.fn(async () => [{
      name: candidate.name, city: candidate.city, region: candidate.region, startsAt: candidate.startsAt,
      endsAt: candidate.endsAt, venue: candidate.venue, url: candidate.website!, rationale: candidate.rationale!,
      crmMatch: { status: "new_prospect" as const },
    }]);
    const worker = new LeadScoutWorker({ repository: repo as never, provider: {} as never, matcher });
    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });
    expect(repo.setCandidateCrmMatch).toHaveBeenCalledWith("run-1", "c1", { status: "new_prospect" });
    expect(repo.updateProgress).toHaveBeenCalledWith("run-1", expect.objectContaining({ candidatesCompared: 1, stage: "fit_rank" }));
  });

  it("aborts an in-flight provider request after cancellation is requested", async () => {
    let cancelled = false;
    const repo = repository("source_discovery");
    repo.isCancellationRequested.mockImplementation(async () => cancelled);
    const provider = {
      discoverSources: vi.fn((_criteria, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        setTimeout(() => { cancelled = true; }, 5);
      })),
      discoverCandidates: vi.fn(),
    };
    const worker = new LeadScoutWorker({
      repository: repo as never, provider: provider as never, matcher: vi.fn(), cancellationPollMs: 2,
    });
    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });
    expect(repo.stopRun).toHaveBeenCalledWith("run-1");
    expect(repo.failRun).not.toHaveBeenCalled();
  });

  it("marks provider failures without deleting already persisted candidates", async () => {
    const repo = repository("candidate_discovery", runView({ stage: "candidate_discovery" }));
    const provider = { discoverSources: vi.fn(), discoverCandidates: vi.fn(async () => { throw new Error("provider down"); }) };
    const worker = new LeadScoutWorker({ repository: repo as never, provider: provider as never, matcher: vi.fn() });
    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });
    expect(repo.failRun).toHaveBeenCalledWith("run-1", expect.stringMatching(/provider down/i));
  });
});
