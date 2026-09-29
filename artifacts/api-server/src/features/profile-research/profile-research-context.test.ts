import { describe, expect, it } from "vitest";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { buildProfileResearchContext, detectProfileResearchGaps } from "./profile-research-context";

function profile(overrides: Partial<EventProfile> = {}): EventProfile {
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
    },
    contacts: [],
    selectedContactId: null,
    bookings: [{
      id: "30000000-0000-4000-8000-000000000001",
      name: "River Days 2025",
      primaryContactId: null,
      city: "Fargo",
      region: "ND",
      startsAt: new Date("2025-07-18T17:00:00.000Z"),
      endsAt: new Date("2025-07-20T23:00:00.000Z"),
      status: "completed",
      probability: "possible",
      notes: null,
      actRecordId: null,
    }],
    eventDateFacts: [],
    effectiveEventDate: null,
    notes: [],
    scoutNotes: [],
    history: [],
    followUps: [],
    groups: [],
    sourceProvenance: [],
    ...overrides,
  };
}

describe("profile research context", () => {
  it("detects useful missing profile information", () => {
    const gaps = detectProfileResearchGaps(profile());
    expect(gaps.map((gap) => gap.field)).toEqual(expect.arrayContaining([
      "website",
      "phone",
      "contact",
      "next_event_dates",
    ]));
    expect(gaps.map((gap) => gap.field)).not.toContain("location");
  });

  it("researches the next date even when the profile has no dated booking history", () => {
    const missingDates = profile({ bookings: [] });
    expect(detectProfileResearchGaps(missingDates).map((gap) => gap.field))
      .toContain("next_event_dates");
    expect(buildProfileResearchContext({ profile: missingDates, mode: "quick" }).gaps)
      .toContainEqual(expect.objectContaining({ field: "next_event_dates", targetKind: "event_date_fact" }));
  });

  it("does not flag next event dates when a researched effective date exists", () => {
    const complete = profile({
      effectiveEventDate: {
        startsOn: "2027-07-18",
        endsOn: "2027-07-20",
        displayStatus: "confirmed",
        sourceId: "fact-1",
      },
    });

    expect(detectProfileResearchGaps(complete).map((gap) => gap.field))
      .not.toContain("next_event_dates");
  });

  it("builds search clues from structured profile facts", () => {
    const context = buildProfileResearchContext({ profile: profile(), mode: "quick" });
    expect(context.searchClues).toContain("River Days Fargo ND");
    expect(context.knownFacts).toContainEqual({ key: "location", value: "Fargo, ND", source: "crm" });
  });

  it("accepts minimized history identity clues without exposing note bodies", () => {
    const privateNote = "Talked to Melissa Anderson. Internal pricing note: Amy said never quote this number to the customer. Another sentence. Another sentence.";
    const context = buildProfileResearchContext({
      profile: profile(),
      mode: "deep",
      historyIdentityClues: [
        "Melissa Anderson",
        "Riverfront Park",
        privateNote,
        "melissa@example.com",
        "<p>raw ACT html</p>",
      ],
    });

    expect(context.searchClues).toContain("River Days Melissa Anderson Fargo ND");
    expect(context.searchClues).toContain("River Days Riverfront Park Fargo ND");
    expect(context.searchClues.join(" ")).not.toContain("pricing note");
    expect(context.searchClues.join(" ")).not.toContain("melissa@example.com");
    expect(context.searchClues.join(" ")).not.toContain("raw ACT html");
  });

  it("does not flag contact method when an existing contact is reachable", () => {
    const complete = profile({
      contacts: [{
        id: "20000000-0000-4000-8000-000000000001",
        name: "Melissa Anderson",
        role: "Events Coordinator",
        isPrimary: true,
        phone: null,
        email: "melissa@example.test",
        source: "local",
        actRecordId: null,
        locationName: null,
        locationCity: null,
        locationRegion: null,
      }],
    });
    expect(detectProfileResearchGaps(complete).map((gap) => gap.field)).not.toContain("contact_method");
  });

  it("caps minimized history clues", () => {
    const context = buildProfileResearchContext({
      profile: profile(),
      mode: "quick",
      historyIdentityClues: Array.from({ length: 20 }, (_, index) => `Contact Person ${index}`),
    });
    expect(context.knownFacts.filter((fact) => fact.source === "history")).toHaveLength(8);
    expect(context.searchClues.length).toBeLessThanOrEqual(12);
  });
});
