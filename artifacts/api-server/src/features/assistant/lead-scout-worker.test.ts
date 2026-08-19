import { describe, expect, it, vi } from "vitest";

import { LeadScoutWorker } from "./lead-scout-worker";
import type {
  LeadDiscoveryCriteria,
  LeadScoutCandidateView,
  LeadScoutRunView,
  LeadScoutWorkClaim,
} from "./lead-scout-types";

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
    renewLease: vi.fn(async () => true),
    getRun: vi.fn(async () => view),
    isCancellationRequested: vi.fn(async () => false),
    upsertSources: vi.fn(async () => undefined),
    upsertCandidates: vi.fn(async () => undefined),
    updateProgress: vi.fn(async () => undefined),
    setCandidateCrmMatch: vi.fn(async () => undefined),
    replaceCandidateFacts: vi.fn(async () => undefined),
    startCandidateEnrichment: vi.fn(async () => true),
    completeCandidateEnrichment: vi.fn(async () => undefined),
    failCandidateEnrichment: vi.fn(async () => undefined),
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

function candidateView(overrides: Partial<LeadScoutCandidateView> = {}): LeadScoutCandidateView {
  return {
    id: "c1", name: candidate.name, city: candidate.city, region: candidate.region, venue: candidate.venue,
    startsAt: candidate.startsAt, endsAt: candidate.endsAt, organizerName: null, organizerEmail: null,
    organizerPhone: null, website: candidate.website, eventType: candidate.eventType, recurrenceSummary: null,
    attendanceSummary: null, vendorSummary: null, applicationDeadline: null, fitScore: null,
    fitRationale: candidate.rationale, fitReasons: [], fitCautions: [], crmMatchStatus: "new_prospect",
    matchedOrganizationId: null, matchedBookingId: null, reviewStatus: "unreviewed",
    enrichmentStatus: "needs_enrichment", coverageGaps: [], enrichmentError: null,
    enrichedAt: null, deepenRequestedAt: null, savedOrganizationId: null, savedBookingId: null, facts: [],
    ...overrides,
  };
}

describe("LeadScoutWorker", () => {
  it("persists discovered sources before advancing to candidate discovery", async () => {
    const repo = repository("source_discovery");
    const provider = { discoverSources: vi.fn(async () => [source]), discoverCandidates: vi.fn(), enrichCandidate: vi.fn() };
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
    const provider = { discoverSources: vi.fn(), discoverCandidates: vi.fn(async () => [candidate]), enrichCandidate: vi.fn() };
    const worker = new LeadScoutWorker({ repository: repo as never, provider: provider as never, matcher: vi.fn() });
    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });
    expect(repo.upsertCandidates).toHaveBeenCalledWith("run-1", [candidate]);
    expect(repo.updateProgress).toHaveBeenCalledWith("run-1", expect.objectContaining({ stage: "crm_compare", candidatesFound: 1 }));
  });

  it("compares one candidate locally and advances to candidate enrichment", async () => {
    const view = runView({ stage: "crm_compare", candidates: [candidateView()] });
    const repo = repository("crm_compare", view);
    const matcher = vi.fn(async () => [{
      name: candidate.name, city: candidate.city, region: candidate.region, startsAt: candidate.startsAt,
      endsAt: candidate.endsAt, venue: candidate.venue, url: candidate.website!, rationale: candidate.rationale!,
      crmMatch: { status: "new_prospect" as const },
    }]);
    const worker = new LeadScoutWorker({ repository: repo as never, provider: {} as never, matcher });
    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });
    expect(repo.setCandidateCrmMatch).toHaveBeenCalledWith("run-1", "c1", { status: "new_prospect" });
    expect(repo.updateProgress).toHaveBeenCalledWith("run-1", expect.objectContaining({ candidatesCompared: 1, stage: "candidate_enrichment" }));
  });

  it("persists enrichment sources and facts before recalculating deterministic fit", async () => {
    const view = runView({
      stage: "candidate_enrichment",
      candidates: [candidateView()],
      sources: [{ id: "s1", url: source.url, title: source.title, publisher: source.publisher, category: source.category, retrievedAt: source.retrievedAt }],
    });
    const repo = repository("candidate_enrichment", view);
    const vendorSource = {
      url: "https://example.org/vendors", title: "Vendor application", publisher: "Silver Valley Days",
      category: "vendor_application" as const, retrievedAt: "2026-08-19T18:05:00.000Z", excerpt: "Vendor info",
    };
    const facts = [
      { key: "vendor_path", value: "Vendor applications are open", category: "vendor" as const, confidence: "high" as const, sourceUrls: [vendorSource.url], rationale: "Official application." },
      { key: "organizer_email", value: "events@example.org", category: "contact" as const, confidence: "high" as const, sourceUrls: [vendorSource.url], rationale: "Official contact." },
      { key: "attendance", value: "About 8,000 attendees", category: "attendance" as const, confidence: "medium" as const, sourceUrls: [vendorSource.url], rationale: "Published recap." },
      { key: "site_space", value: "Outdoor downtown footprint", category: "logistics" as const, confidence: "medium" as const, sourceUrls: [vendorSource.url], rationale: "Published site info." },
      { key: "entertainment_path", value: "Entertainment vendors may apply", category: "vendor" as const, confidence: "high" as const, sourceUrls: [vendorSource.url], rationale: "Official participation path." },
    ];
    const provider = {
      discoverSources: vi.fn(), discoverCandidates: vi.fn(),
      enrichCandidate: vi.fn(async () => ({ facts, sources: [vendorSource], coverageGaps: ["Power requirements not published"] })),
    };
    const worker = new LeadScoutWorker({ repository: repo as never, provider: provider as never, matcher: vi.fn() });

    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });

    expect(repo.startCandidateEnrichment).toHaveBeenCalledWith("run-1", "c1");
    expect(repo.upsertSources).toHaveBeenCalledWith("run-1", [vendorSource]);
    expect(repo.replaceCandidateFacts).toHaveBeenCalledWith("run-1", "c1", facts);
    expect(repo.completeCandidateEnrichment).toHaveBeenCalledWith("run-1", "c1", expect.objectContaining({
      coverageGaps: ["Power requirements not published"],
      organizerEmail: "events@example.org",
      vendorSummary: "Vendor applications are open",
    }));
    expect(repo.setCandidateFit).toHaveBeenCalledTimes(1);
    const fit = repo.setCandidateFit.mock.calls[0]?.[2];
    expect(fit?.score).toBeGreaterThan(70);
    expect(fit?.reasons.join(" ")).toMatch(/family|vendor|entertainment/i);
    expect(repo.updateProgress).toHaveBeenCalledWith("run-1", expect.objectContaining({ candidatesEnriched: 1 }));
  });

  it("keeps a candidate visible when its deep enrichment fails instead of failing the whole run", async () => {
    const repo = repository("candidate_enrichment", runView({ stage: "candidate_enrichment", candidates: [candidateView()] }));
    const provider = {
      discoverSources: vi.fn(), discoverCandidates: vi.fn(),
      enrichCandidate: vi.fn(async () => { throw new Error("vendor page unavailable"); }),
    };
    const worker = new LeadScoutWorker({ repository: repo as never, provider: provider as never, matcher: vi.fn() });

    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });

    expect(repo.failCandidateEnrichment).toHaveBeenCalledWith("run-1", "c1", expect.stringMatching(/vendor page unavailable/i));
    expect(repo.failRun).not.toHaveBeenCalled();
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
      discoverCandidates: vi.fn(), enrichCandidate: vi.fn(),
    };
    const worker = new LeadScoutWorker({ repository: repo as never, provider: provider as never, matcher: vi.fn(), cancellationPollMs: 2 });
    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });
    expect(repo.stopRun).toHaveBeenCalledWith("run-1");
    expect(repo.failRun).not.toHaveBeenCalled();
  });

  it("marks broad provider failures without deleting already persisted candidates", async () => {
    const repo = repository("candidate_discovery", runView({ stage: "candidate_discovery" }));
    const provider = { discoverSources: vi.fn(), discoverCandidates: vi.fn(async () => { throw new Error("provider down"); }), enrichCandidate: vi.fn() };
    const worker = new LeadScoutWorker({ repository: repo as never, provider: provider as never, matcher: vi.fn() });
    await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-19T18:00:00Z") });
    expect(repo.failRun).toHaveBeenCalledWith("run-1", expect.stringMatching(/provider down/i));
  });
});
