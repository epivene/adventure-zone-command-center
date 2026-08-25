import { describe, expect, it, vi } from "vitest";

import { ResearchProspectIntakeService } from "./research-prospect-intake";
import type { RelatedEventOpportunity } from "./profile-research-discovery";

const researched: RelatedEventOpportunity = {
  name: "Stale Event Name",
  city: "Old City",
  region: "CO",
  startsAt: "2026-09-01",
  endsAt: "2026-09-02",
  venue: "Old Venue",
  url: "https://old.example/event",
  rationale: "A very long research narrative that must never be inserted into Notes.",
};

const scoutNote = {
  type: "scout_note" as const,
  version: 1 as const,
  runId: "30000000-0000-4000-8000-000000000001",
  candidateId: "40000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-19T18:10:00.000Z",
  originalQuestion: "Find family-friendly events in Idaho in September 2026",
  criteriaSummary: "Idaho · September 2026",
  fitScore: 88,
  summary: "Strong family fit",
  positives: ["family audience"],
  cautions: ["Confirm that no inflatable provider is already contracted"],
  coverageGaps: ["Power availability has not been verified"],
  suggestedNextAction: { kind: "prepare_quote" as const, dueAt: "2026-08-24" },
  sources: [
    {
      url: "https://example.org/silver-valley-days",
      title: "Official Silver Valley Days event page",
      publisher: "Silver Valley Days",
      category: "official_event",
      retrievedAt: "2026-08-19T18:05:00.000Z",
    },
  ],
};

function accepted(overrides: Record<string, unknown> = {}) {
  return {
    name: "Silver Valley Days",
    city: "Kellogg",
    region: "ID",
    startsAt: "2026-09-11",
    endsAt: "2026-09-13",
    website: "https://example.org/silver-valley-days",
    contactName: "Jamie Organizer",
    contactEmail: "jamie@example.org",
    contactPhone: "208-555-0100",
    ...overrides,
  };
}

function store(match: any = { status: "new_prospect" }) {
  return {
    classify: vi.fn(async () => match),
    createLead: vi.fn(async () => ({ profileId: "profile-1", bookingId: "booking-1" })),
  };
}

describe("ResearchProspectIntakeService", () => {
  it("requires an allowed first action and a valid follow-up date", async () => {
    const fake = store();
    const service = new ResearchProspectIntakeService(fake as never);

    await expect(service.create({
      event: researched,
      accepted: accepted() as any,
      nextActionKind: "call",
      nextActionDueAt: "",
    })).rejects.toThrow("RESEARCH_PROSPECT_FOLLOW_UP_REQUIRED");

    await expect(service.create({
      event: researched,
      accepted: accepted() as any,
      nextActionKind: "fax" as any,
      nextActionDueAt: "2026-08-24",
    })).rejects.toThrow("RESEARCH_PROSPECT_ACTION_REQUIRED");

    expect(fake.classify).not.toHaveBeenCalled();
    expect(fake.createLead).not.toHaveBeenCalled();
  });

  it("rejects unsafe URLs, missing locations, and reversed dates", async () => {
    const fake = store();
    const service = new ResearchProspectIntakeService(fake as never);

    await expect(service.create({ event: researched, accepted: accepted({ website: "javascript:alert(1)" }) as any, nextActionKind: "email", nextActionDueAt: "2026-08-24" }))
      .rejects.toThrow("RESEARCH_PROSPECT_PUBLIC_URL_REQUIRED");
    await expect(service.create({ event: researched, accepted: accepted({ city: "" }) as any, nextActionKind: "email", nextActionDueAt: "2026-08-24" }))
      .rejects.toThrow("RESEARCH_PROSPECT_LOCATION_REQUIRED");
    await expect(service.create({ event: researched, accepted: accepted({ startsAt: "2026-09-20", endsAt: "2026-09-10" }) as any, nextActionKind: "email", nextActionDueAt: "2026-08-24" }))
      .rejects.toThrow("RESEARCH_PROSPECT_DATE_RANGE_INVALID");
  });

  it("rechecks duplicates using accepted values immediately before creation", async () => {
    const fake = store({ status: "possible_match", organizationId: "org-existing", bookingId: "booking-existing", matchedName: "Silver Valley Days" });
    const service = new ResearchProspectIntakeService(fake as never);

    const result = await service.create({
      event: researched,
      accepted: accepted() as any,
      nextActionKind: "call",
      nextActionDueAt: "2026-08-24",
      scoutNote: { ...scoutNote, suggestedNextAction: { kind: "call", dueAt: "2026-08-24" } },
    });

    expect(result).toEqual({ kind: "duplicate", match: expect.objectContaining({ status: "possible_match", organizationId: "org-existing" }) });
    expect(fake.classify).toHaveBeenCalledWith(expect.objectContaining({
      name: "Silver Valley Days",
      city: "Kellogg",
      region: "ID",
      startsAt: "2026-09-11",
      url: "https://example.org/silver-valley-days",
    }));
    expect(fake.createLead).not.toHaveBeenCalled();
  });

  it("creates new_lead + possible intake and keeps approved Scout Notes in the same store call", async () => {
    const fake = store();
    const service = new ResearchProspectIntakeService(fake as never);

    const result = await service.create({
      event: researched,
      accepted: accepted() as any,
      nextActionKind: "prepare_quote",
      nextActionDueAt: "2026-08-24",
      scoutNote,
    });

    expect(result).toEqual({ kind: "created", profileId: "profile-1", bookingId: "booking-1" });
    expect(fake.createLead).toHaveBeenCalledWith({
      accepted: accepted(),
      booking: {
        status: "new_lead",
        probability: "possible",
        nextActionKind: "prepare_quote",
        nextActionDueAt: "2026-08-24",
      },
      scoutNote,
    });
    const serialized = JSON.stringify(fake.createLead.mock.calls[0]?.[0]);
    expect(serialized).not.toContain(researched.rationale);
    expect(serialized).not.toContain("Old City");
  });
});