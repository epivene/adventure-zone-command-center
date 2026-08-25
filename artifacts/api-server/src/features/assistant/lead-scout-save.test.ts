import { describe, expect, it, vi } from "vitest";

import { LeadScoutService } from "./lead-scout-service";
import type { LeadScoutRunView } from "./lead-scout-types";

const source = {
  id: "50000000-0000-4000-8000-000000000001",
  url: "https://example.org/silver-valley-days",
  title: "Official Silver Valley Days event page",
  publisher: "Silver Valley Days",
  category: "official_event" as const,
  retrievedAt: "2026-08-19T18:05:00.000Z",
};

const candidate = {
  id: "40000000-0000-4000-8000-000000000001",
  name: "Silver Valley Days",
  city: "Kellogg",
  region: "ID",
  venue: "Downtown",
  startsAt: "2026-09-11",
  endsAt: "2026-09-13",
  organizerName: "Jamie Organizer",
  organizerEmail: "jamie@example.org",
  organizerPhone: "208-555-0100",
  website: "https://example.org/silver-valley-days",
  eventType: "community festival",
  recurrenceSummary: "Annual festival",
  attendanceSummary: "8,000 last year",
  vendorSummary: "Vendor applications open",
  applicationDeadline: "2026-06-01",
  fitScore: 88,
  fitRationale: "Strong family fit",
  fitReasons: ["family audience"],
  fitCautions: ["Confirm that no inflatable provider is already contracted"],
  crmMatchStatus: "new_prospect" as const,
  matchedOrganizationId: null,
  matchedBookingId: null,
  reviewStatus: "unreviewed" as const,
  enrichmentStatus: "enriched" as const,
  coverageGaps: ["Power availability has not been verified"],
  enrichmentError: null,
  enrichedAt: "2026-08-19T18:10:00.000Z",
  deepenRequestedAt: null,
  savedOrganizationId: null,
  savedBookingId: null,
  facts: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      key: "family_signal",
      value: "Family activities are promoted",
      category: "vendor",
      confidence: "high" as const,
      rationale: "The official event page promotes family programming.",
      sourceIds: [source.id],
    },
  ],
};

function run(overrides: Partial<LeadScoutRunView> = {}): LeadScoutRunView {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    originalQuestion: "Find events in Idaho in September 2026",
    criteria: null,
    criteriaSummary: "Idaho · September 2026",
    status: "complete",
    stage: "complete",
    progress: { label: "Search complete", sourcesChecked: 10, candidatesFound: 1, candidatesEnriched: 1, candidatesCompared: 1 },
    crmMatches: [],
    candidates: [candidate],
    sources: [source],
    startedAt: "2026-08-19T18:00:00.000Z",
    completedAt: "2026-08-19T18:10:00.000Z",
    createdAt: "2026-08-19T18:00:00.000Z",
    updatedAt: "2026-08-19T18:10:00.000Z",
    failureMessage: null,
    ...overrides,
  };
}

function dependencies(view = run()) {
  const repository = {
    getRun: vi.fn(async () => view),
    setCandidateCrmMatch: vi.fn(async () => undefined),
  };
  const intake = {
    create: vi.fn(async () => ({ kind: "created" as const, profileId: "profile-1", bookingId: "booking-1" })),
  };
  const saveLinker = {
    markSaved: vi.fn(async () => true),
  };
  return { repository, intake, saveLinker };
}

const accepted = {
  name: "Silver Valley Days & Family Fest",
  city: "Kellogg",
  region: "ID",
  startsAt: "2026-09-11",
  endsAt: "2026-09-13",
  website: "https://example.org/silver-valley-days",
  contactName: "Jamie Organizer",
  contactEmail: "jamie@example.org",
  contactPhone: "208-555-0100",
};

describe("LeadScoutService.saveCandidate", () => {
  it("uses the latest persisted candidate plus accepted edits, required first action, and Scout Notes", async () => {
    const deps = dependencies();
    const service = new LeadScoutService({ repository: deps.repository as never, intake: deps.intake as never, saveLinker: deps.saveLinker });

    const result = await service.saveCandidate({
      actorId: "owner-1",
      runId: run().id,
      candidateId: candidate.id,
      accepted,
      nextActionKind: "call",
      nextActionDueAt: "2026-08-24",
    });

    expect(deps.intake.create).toHaveBeenCalledWith({
      event: expect.objectContaining({
        name: candidate.name,
        city: candidate.city,
        region: candidate.region,
        url: candidate.website,
      }),
      accepted,
      nextActionKind: "call",
      nextActionDueAt: "2026-08-24",
      scoutNote: expect.objectContaining({
        type: "scout_note",
        version: 1,
        runId: run().id,
        candidateId: candidate.id,
        createdAt: expect.any(String),
        originalQuestion: "Find events in Idaho in September 2026",
        criteriaSummary: "Idaho · September 2026",
        fitScore: 88,
        summary: "Strong family fit",
        positives: ["family audience"],
        cautions: ["Confirm that no inflatable provider is already contracted"],
        coverageGaps: ["Power availability has not been verified"],
        suggestedNextAction: { kind: "call", dueAt: "2026-08-24" },
        sources: [{
          url: source.url,
          title: source.title,
          publisher: source.publisher,
          category: source.category,
          retrievedAt: source.retrievedAt,
        }],
      }),
    });
    expect(deps.saveLinker.markSaved).toHaveBeenCalledWith({
      runId: run().id,
      actorId: "owner-1",
      candidateId: candidate.id,
      profileId: "profile-1",
      bookingId: "booking-1",
    });
    expect(result).toMatchObject({ kind: "created", profileId: "profile-1", bookingId: "booking-1" });
  });

  it("does not mark a candidate saved when the intake duplicate recheck finds a match", async () => {
    const deps = dependencies();
    deps.intake.create.mockResolvedValueOnce({
      kind: "duplicate" as const,
      match: { status: "possible_match", organizationId: "existing-org", bookingId: "existing-booking", matchedName: "Silver Valley Days" },
    } as any);
    const service = new LeadScoutService({ repository: deps.repository as never, intake: deps.intake as never, saveLinker: deps.saveLinker });

    const result = await service.saveCandidate({
      actorId: "owner-1", runId: run().id, candidateId: candidate.id, accepted,
      nextActionKind: "email", nextActionDueAt: "2026-08-24",
    });

    expect(result.kind).toBe("duplicate");
    expect(deps.saveLinker.markSaved).not.toHaveBeenCalled();
    expect(deps.repository.setCandidateCrmMatch).toHaveBeenCalledWith(run().id, candidate.id, expect.objectContaining({ status: "possible_match" }));
  });

  it("rejects active, existing/possible, dismissed, or already-saved candidates", async () => {
    for (const view of [
      run({ status: "running", stage: "candidate_enrichment" }),
      run({ candidates: [{ ...candidate, crmMatchStatus: "possible_match", matchedOrganizationId: "org-1" }] as any }),
      run({ candidates: [{ ...candidate, reviewStatus: "dismissed" }] as any }),
      run({ candidates: [{ ...candidate, reviewStatus: "saved", savedOrganizationId: "org-1" }] as any }),
    ]) {
      const deps = dependencies(view);
      const service = new LeadScoutService({ repository: deps.repository as never, intake: deps.intake as never, saveLinker: deps.saveLinker });
      await expect(service.saveCandidate({
        actorId: "owner-1", runId: view.id, candidateId: candidate.id, accepted,
        nextActionKind: "call", nextActionDueAt: "2026-08-24",
      })).rejects.toThrow("LEAD_SCOUT_CANDIDATE_NOT_SAVEABLE");
      expect(deps.intake.create).not.toHaveBeenCalled();
    }
  });
});