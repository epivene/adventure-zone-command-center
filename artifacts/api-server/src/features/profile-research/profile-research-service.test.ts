import { describe, expect, it, vi } from "vitest";

import { ProfileResearchService } from "./profile-research-service";
import type { ProfileResearchProvider } from "./profile-research-provider";

function profile(overrides: any = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    place: {
      id: "10000000-0000-4000-8000-000000000001",
      name: "River Days",
      placeType: "festival_event",
      phone: null,
      address1: null,
      address2: null,
      city: "Fargo",
      region: "ND",
      postalCode: null,
      website: null,
      lastResort: false,
      lastResortReason: null,
      actRecordId: null,
      ...overrides.place,
    },
    contacts: overrides.contacts ?? [{
      id: "20000000-0000-4000-8000-000000000001",
      name: "Melissa Anderson",
      role: "Events Coordinator",
      isPrimary: true,
      phone: null,
      email: null,
      source: "local",
      actRecordId: null,
      locationName: null,
      locationCity: null,
      locationRegion: null,
    }],
    selectedContactId: "20000000-0000-4000-8000-000000000001",
    bookings: overrides.bookings ?? [],
    notes: [],
    followUps: [],
    groups: [],
    sourceProvenance: [],
  } as any;
}

function harness(providerResult: any, profileValue = profile()) {
  let saved: any = null;
  let failed: string | null = null;
  const runs = {
    createRun: vi.fn().mockResolvedValue("30000000-0000-4000-8000-000000000001"),
    completeRun: vi.fn(async (input: any) => { saved = input; }),
    failRun: vi.fn(async (_runId: string, _profileId: string, message: string) => { failed = message; }),
    getRun: vi.fn(async (_profileId: string, runId: string) => ({
      id: runId,
      profileId: profileValue.id,
      mode: "quick",
      status: failed ? "failed" : "complete",
      requestedBy: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      failureMessage: failed,
      context: saved?.context ?? {},
      summary: saved?.summary ?? null,
      sources: saved?.sources ?? [],
      suggestions: (saved?.suggestions ?? []).map((suggestion: any) => ({ ...suggestion, reviewStatus: "pending" })),
    })),
    setSuggestionReview: vi.fn().mockResolvedValue(true),
  };
  const provider: ProfileResearchProvider = {
    research: vi.fn().mockImplementation(async () => {
      if (providerResult instanceof Error) throw providerResult;
      return providerResult;
    }),
  };
  const profiles = { getEventProfile: vi.fn().mockResolvedValue(profileValue) };
  return { service: new ProfileResearchService(runs as any, provider, profiles as any), runs, provider, profiles, saved: () => saved, failed: () => failed };
}

const citedSource = {
  id: "source-1",
  kind: "web" as const,
  title: "River Days",
  url: "https://riverdays.example",
  publisher: "riverdays.example",
  retrievedAt: new Date().toISOString(),
  excerpt: "Official event website",
};

describe("ProfileResearchService", () => {
  it("persists an evidence-backed missing-field suggestion", async () => {
    const test = harness({
      identity: { confidence: "high", rationale: "Official source matched." },
      sources: [citedSource],
      candidates: [{
        targetKind: "organization",
        targetId: null,
        field: "website",
        value: "https://riverdays.example",
        rationale: "Official website",
        sourceUrls: ["https://riverdays.example"],
      }],
      deepSummary: null,
    });

    await test.service.start({ profileId: profile().id, mode: "quick" });

    expect(test.runs.completeRun).toHaveBeenCalledTimes(1);
    expect(test.saved().suggestions).toEqual([
      expect.objectContaining({ field: "website", currentValue: null, suggestedValue: "https://riverdays.example", confidence: "high", conflict: false, sourceIds: ["source-1"] }),
    ]);
  });

  it("creates a date-fact suggestion without targeting the historical booking", async () => {
    const pastBooking = {
      id: "past-booking",
      name: "River Days 2026",
      primaryContactId: null,
      city: "Fargo",
      region: "ND",
      startsAt: new Date("2026-07-18T17:00:00Z"),
      endsAt: new Date("2026-07-20T17:00:00Z"),
      status: "completed",
      probability: "possible",
      notes: null,
      actRecordId: null,
    };
    const test = harness({
      identity: { confidence: "high", rationale: "Official source matched." },
      sources: [citedSource],
      candidates: [],
      eventDateCandidates: [{
        startsOn: "2027-07-17",
        endsOn: "2027-07-19",
        evidenceKind: "published_exact",
        recurrenceRule: null,
        rationale: "Official dates",
        source: citedSource,
        confidence: 0.98,
      }],
      deepSummary: null,
    }, profile({ bookings: [pastBooking] }));

    await test.service.start({ profileId: profile().id, mode: "quick" });

    expect(test.saved().suggestions).toEqual([
      expect.objectContaining({
        targetKind: "event_date_fact",
        targetId: null,
        field: "eventDate",
        currentValue: null,
      }),
    ]);
  });

  it("flags a different non-empty current value as a conflict", async () => {
    const test = harness({
      identity: { confidence: "high", rationale: "Official source matched." },
      sources: [citedSource],
      candidates: [{ targetKind: "organization", targetId: null, field: "website", value: "https://riverdays.example", rationale: "New official site", sourceUrls: ["https://riverdays.example"] }],
      deepSummary: null,
    }, profile({ place: { website: "https://old.example" } }));

    await test.service.start({ profileId: profile().id, mode: "quick" });

    expect(test.saved().suggestions[0]).toEqual(expect.objectContaining({ currentValue: "https://old.example", conflict: true }));
  });

  it("does not create writable suggestions when identity confidence is low", async () => {
    const test = harness({
      identity: { confidence: "low", rationale: "Multiple same-name events." },
      sources: [citedSource],
      candidates: [{ targetKind: "organization", targetId: null, field: "website", value: "https://riverdays.example", rationale: "Possible match", sourceUrls: ["https://riverdays.example"] }],
      deepSummary: null,
    });

    await test.service.start({ profileId: profile().id, mode: "quick" });
    expect(test.saved().suggestions).toEqual([]);
  });

  it("does not turn a discovered organizer into a brand-new contact automatically", async () => {
    const test = harness({
      identity: { confidence: "high", rationale: "Official source matched." },
      sources: [citedSource],
      candidates: [{ targetKind: "contact", targetId: null, field: "name", value: "Jane Newperson", rationale: "Official organizer listing", sourceUrls: ["https://riverdays.example"] }],
      deepSummary: null,
    }, profile({ contacts: [] }));

    await test.service.start({ profileId: profile().id, mode: "quick" });
    expect(test.saved().suggestions).toEqual([]);
  });

  it("persists provider failures as failed research runs instead of reporting no information", async () => {
    const test = harness(new Error("web provider unavailable"));
    const run = await test.service.start({ profileId: profile().id, mode: "quick" });

    expect(test.runs.failRun).toHaveBeenCalledTimes(1);
    expect(test.failed()).toContain("web provider unavailable");
    expect(run?.status).toBe("failed");
  });
});
