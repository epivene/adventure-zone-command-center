import { describe, expect, it, vi } from "vitest";

import { ScoutAlertWorker } from "./scout-alert-worker";
import type { LeadScoutProvider } from "./lead-scout-provider";
import type {
  ScoutAlertRepository,
  ScoutAlertWatchClaim,
  ScoutAlertWatchContext,
} from "./scout-alert-repository";
import type { ScoutAlertSnapshot } from "./scout-alert-types";

const NOW = new Date("2026-08-25T12:00:00.000Z");

function snapshot(overrides: Partial<ScoutAlertSnapshot> = {}): ScoutAlertSnapshot {
  return {
    startsAt: "2026-11-10",
    endsAt: "2026-11-12",
    applicationAvailable: true,
    applicationUrl: "https://example.org/vendors",
    applicationDeadline: "2026-10-15",
    organizerName: "Fair Office",
    organizerEmail: "fair@example.org",
    organizerPhone: "208-555-0100",
    coverageGaps: [],
    sources: [{
      url: "https://example.org/fair",
      title: "Official fair page",
      publisher: "Fair Office",
      category: "official_event",
      retrievedAt: NOW.toISOString(),
    }],
    capturedAt: NOW.toISOString(),
    ...overrides,
  };
}

function claim(overrides: Partial<ScoutAlertWatchClaim> = {}): ScoutAlertWatchClaim {
  return {
    watchId: "watch-1",
    workerId: "worker-a",
    actorId: "owner-a",
    runId: "run-1",
    candidateId: "candidate-1",
    organizationId: "org-1",
    bookingId: "booking-1",
    nextResearchAt: "2026-09-01T12:00:00.000Z",
    failureCount: 0,
    snapshot: snapshot(),
    leaseExpiresAt: "2026-08-25T12:01:00.000Z",
    ...overrides,
  };
}

function context(overrides: Partial<ScoutAlertWatchContext> = {}): ScoutAlertWatchContext {
  return {
    claim: claim(),
    profileName: "Twin Falls County Fair",
    bookingStatus: "possible",
    bookingEndsAt: "2026-11-12",
    criteria: {
      originalQuestion: "Find an Idaho fair",
      dateFrom: "2026-11-01",
      dateThrough: "2026-11-30",
      month: 11,
      year: 2026,
      regions: ["ID"],
      cities: [],
      geoMode: "regions",
      routeId: null,
      legId: null,
      eventKeywords: ["fair"],
      fitIntent: "either",
    },
    candidate: {
      id: "candidate-1",
      name: "Twin Falls County Fair",
      city: "Filer",
      region: "ID",
      venue: "Fairgrounds",
      startsAt: "2026-11-10",
      endsAt: "2026-11-12",
      organizerName: "Fair Office",
      organizerEmail: "fair@example.org",
      organizerPhone: "208-555-0100",
      website: "https://example.org/fair",
      eventType: "county fair",
      recurrenceSummary: "Annual fair",
      attendanceSummary: null,
      vendorSummary: "Applications are open at https://example.org/vendors",
      applicationDeadline: "2026-10-15",
      fitScore: 87,
      fitRationale: "Strong family fit",
      fitReasons: [],
      fitCautions: [],
      crmMatchStatus: "existing",
      matchedOrganizationId: "org-1",
      matchedBookingId: "booking-1",
      reviewStatus: "saved",
      enrichmentStatus: "enriched",
      coverageGaps: [],
      enrichmentError: null,
      enrichedAt: "2026-08-20T12:00:00.000Z",
      deepenRequestedAt: null,
      savedOrganizationId: "org-1",
      savedBookingId: "booking-1",
      facts: [],
    },
    knownSources: Array.from({ length: 40 }, (_, index) => ({
      url: `https://example.org/source-${index}`,
      title: `Source ${index}`,
      publisher: "Fair Office",
      category: "official_event" as const,
      retrievedAt: NOW.toISOString(),
    })),
    ...overrides,
  };
}

function dependencies(input?: {
  claim?: ScoutAlertWatchClaim | null;
  context?: ScoutAlertWatchContext | null;
  enrichment?: any;
  providerError?: Error;
}) {
  const claimed: ScoutAlertWatchClaim | null = input && "claim" in input ? input.claim ?? null : claim();
  const loaded: ScoutAlertWatchContext | null = input && "context" in input ? input.context ?? null : context({ claim: claimed ?? claim() });
  const repository = {
    claimDue: vi.fn(async () => claimed),
    loadContext: vi.fn(async () => loaded),
    saveSuccess: vi.fn(async (_input: Parameters<ScoutAlertRepository["saveSuccess"]>[0]) => undefined),
    recordFailure: vi.fn(async (_input: Parameters<ScoutAlertRepository["recordFailure"]>[0]) => undefined),
    completeWatch: vi.fn(async (_input: Parameters<ScoutAlertRepository["completeWatch"]>[0]) => undefined),
  };
  const provider = {
    enrichCandidate: input?.providerError
      ? vi.fn(async (_input: Parameters<LeadScoutProvider["enrichCandidate"]>[0]) => { throw input.providerError; })
      : vi.fn(async (_input: Parameters<LeadScoutProvider["enrichCandidate"]>[0]) => input?.enrichment ?? ({ facts: [], sources: [], coverageGaps: [] })),
  };
  return { repository, provider };
}

describe("ScoutAlertWorker", () => {
  it("returns idle without touching the provider when no watch is due", async () => {
    const deps = dependencies({ claim: null, context: null });
    const worker = new ScoutAlertWorker({ repository: deps.repository, provider: deps.provider });

    await expect(worker.runOne({ workerId: "worker-a", now: NOW })).resolves.toEqual({ kind: "idle" });
    expect(deps.provider.enrichCandidate).not.toHaveBeenCalled();
  });

  it("completes a claimed watch whose context disappeared", async () => {
    const deps = dependencies({ context: null });
    const worker = new ScoutAlertWorker({ repository: deps.repository, provider: deps.provider });

    await expect(worker.runOne({ workerId: "worker-a", now: NOW })).resolves.toEqual({ kind: "progress" });
    expect(deps.repository.completeWatch).toHaveBeenCalledWith({ claim: expect.objectContaining({ watchId: "watch-1" }), now: NOW });
    expect(deps.provider.enrichCandidate).not.toHaveBeenCalled();
  });

  it("seeds a baseline and evaluates local deadline and gap alerts without an external call", async () => {
    const baselineClaim = claim({
      snapshot: null,
      nextResearchAt: "2026-09-01T12:00:00.000Z",
    });
    const deps = dependencies({
      claim: baselineClaim,
      context: context({
        claim: baselineClaim,
        candidate: {
          ...context().candidate,
          applicationDeadline: "2026-08-31",
          coverageGaps: ["Power requirements were not published."],
        },
      }),
    });
    const worker = new ScoutAlertWorker({ repository: deps.repository, provider: deps.provider });

    await worker.runOne({ workerId: "worker-a", now: NOW });

    expect(deps.provider.enrichCandidate).not.toHaveBeenCalled();
    expect(deps.repository.saveSuccess).toHaveBeenCalledWith(expect.objectContaining({
      researched: false,
      alerts: expect.arrayContaining([
        expect.objectContaining({ kind: "deadline_approaching" }),
        expect.objectContaining({ kind: "needs_verification" }),
      ]),
      nextEvaluationAt: new Date("2026-08-26T12:00:00.000Z"),
      nextResearchAt: new Date("2026-09-01T12:00:00.000Z"),
    }));
  });

  it("runs one bounded refresh when research is due and persists detected changes", async () => {
    const dueClaim = claim({
      nextResearchAt: "2026-08-25T11:00:00.000Z",
      snapshot: snapshot({ startsAt: null, endsAt: null, applicationAvailable: false, applicationUrl: null }),
    });
    const dueContext = context({ claim: dueClaim });
    const deps = dependencies({
      claim: dueClaim,
      context: dueContext,
      enrichment: {
        facts: [
          {
            key: "event_dates",
            value: "2026-11-10 through 2026-11-12",
            category: "schedule",
            confidence: "high",
            sourceUrls: ["https://example.org/official-refresh"],
            rationale: "Official event page",
          },
          {
            key: "vendor_application",
            value: "https://example.org/vendors",
            category: "vendor",
            confidence: "high",
            sourceUrls: ["https://example.org/vendors"],
            rationale: "Official vendor page",
          },
        ],
        sources: [
          {
            url: "https://example.org/official-refresh",
            title: "Official dates",
            publisher: "Fair Office",
            category: "official_event",
            retrievedAt: NOW.toISOString(),
          },
          {
            url: "https://example.org/vendors",
            title: "Vendor application",
            publisher: "Fair Office",
            category: "vendor_application",
            retrievedAt: NOW.toISOString(),
          },
        ],
        coverageGaps: [],
      },
    });
    const worker = new ScoutAlertWorker({ repository: deps.repository, provider: deps.provider });

    await worker.runOne({ workerId: "worker-a", now: NOW });

    expect(deps.provider.enrichCandidate).toHaveBeenCalledTimes(1);
    expect(deps.provider.enrichCandidate.mock.calls[0]?.[0].knownSources).toHaveLength(32);
    expect(deps.repository.saveSuccess).toHaveBeenCalledWith(expect.objectContaining({
      researched: true,
      alerts: expect.arrayContaining([
        expect.objectContaining({ kind: "dates_announced" }),
        expect.objectContaining({ kind: "application_opened" }),
      ]),
    }));
  });

  it("uses a 24-hour refresh cadence near an event or deadline and seven days otherwise", async () => {
    const nearClaim = claim({ nextResearchAt: "2026-08-25T11:00:00.000Z" });
    const nearDeps = dependencies({
      claim: nearClaim,
      context: context({
        claim: nearClaim,
        candidate: {
          ...context().candidate,
          startsAt: "2026-09-10",
          endsAt: "2026-09-12",
          applicationDeadline: "2026-09-15",
        },
      }),
    });
    await new ScoutAlertWorker({ repository: nearDeps.repository, provider: nearDeps.provider })
      .runOne({ workerId: "worker-a", now: NOW });
    expect(nearDeps.repository.saveSuccess.mock.calls[0]?.[0].nextResearchAt)
      .toEqual(new Date("2026-08-26T12:00:00.000Z"));

    const normalClaim = claim({ nextResearchAt: "2026-08-25T11:00:00.000Z" });
    const normalDeps = dependencies({ claim: normalClaim, context: context({ claim: normalClaim }) });
    await new ScoutAlertWorker({ repository: normalDeps.repository, provider: normalDeps.provider })
      .runOne({ workerId: "worker-a", now: NOW });
    expect(normalDeps.repository.saveSuccess.mock.calls[0]?.[0].nextResearchAt)
      .toEqual(new Date("2026-09-01T12:00:00.000Z"));
  });

  it.each(["completed", "cancelled", "declined"])("completes a final %s booking watch", async (status) => {
    const deps = dependencies({ context: context({ bookingStatus: status }) });
    await new ScoutAlertWorker({ repository: deps.repository, provider: deps.provider })
      .runOne({ workerId: "worker-a", now: NOW });
    expect(deps.repository.completeWatch).toHaveBeenCalled();
    expect(deps.provider.enrichCandidate).not.toHaveBeenCalled();
  });

  it("completes monitoring fourteen days after an event ends", async () => {
    const deps = dependencies({
      context: context({
        bookingEndsAt: "2026-08-10",
        candidate: { ...context().candidate, endsAt: "2026-08-10" },
      }),
    });
    await new ScoutAlertWorker({ repository: deps.repository, provider: deps.provider })
      .runOne({ workerId: "worker-a", now: NOW });
    expect(deps.repository.completeWatch).toHaveBeenCalled();
  });

  it.each([
    [0, "2026-08-25T18:00:00.000Z"],
    [1, "2026-08-26T00:00:00.000Z"],
    [2, "2026-08-26T12:00:00.000Z"],
    [5, "2026-09-01T12:00:00.000Z"],
  ] as const)("backs off after failure count %s", async (failureCount, retryAt) => {
    const failedClaim = claim({
      failureCount,
      nextResearchAt: "2026-08-25T11:00:00.000Z",
    });
    const deps = dependencies({
      claim: failedClaim,
      context: context({ claim: failedClaim }),
      providerError: new Error("Provider unavailable"),
    });
    await new ScoutAlertWorker({ repository: deps.repository, provider: deps.provider })
      .runOne({ workerId: "worker-a", now: NOW });

    expect(deps.repository.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      safeError: "Provider unavailable",
      nextRetryAt: new Date(retryAt),
    }));
    const expectedNewCount = failureCount + 1;
    const failureAlert = deps.repository.recordFailure.mock.calls[0]?.[0].failureAlert;
    expect(Boolean(failureAlert)).toBe(expectedNewCount >= 3);
  });
});
