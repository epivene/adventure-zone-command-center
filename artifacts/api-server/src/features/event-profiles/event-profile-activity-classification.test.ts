import { describe, expect, it } from "vitest";

import { buildEventProfile, type EventProfileRecordSet } from "./event-profile-repository";

const scoutNoteBody = JSON.stringify({
  type: "scout_note",
  version: 1,
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
  suggestedNextAction: { kind: "call", dueAt: "2026-08-24" },
  sources: [
    {
      url: "https://example.org/silver-valley-days",
      title: "Official Silver Valley Days event page",
      publisher: "Silver Valley Days",
      category: "official_event",
      retrievedAt: "2026-08-19T18:05:00.000Z",
    },
  ],
});

function records(): EventProfileRecordSet {
  const base = new Date("2025-07-04T12:00:00Z");
  return {
    place: {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Example Event",
      placeType: "festival_event",
      phone: null,
      address1: null,
      address2: null,
      city: "Alamosa",
      region: "CO",
      postalCode: null,
      website: null,
      lastResort: false,
      lastResortReason: null,
      actRecordId: "act-company-1",
    },
    contacts: [],
    bookings: [],
    activities: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        contactId: null,
        bookingId: null,
        kind: "note",
        body: "Local note",
        occurredAt: base,
        createdAt: base,
        updatedAt: base,
        importedFromAct: false,
        actSourceType: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        contactId: null,
        bookingId: null,
        kind: "note",
        body: "EVENT DATES: July 4, 2023",
        occurredAt: base,
        createdAt: base,
        updatedAt: base,
        importedFromAct: true,
        actSourceType: "note",
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        contactId: null,
        bookingId: null,
        kind: "act_history",
        body: "Called fair office",
        occurredAt: base,
        createdAt: base,
        updatedAt: base,
        importedFromAct: true,
        actSourceType: "history",
      },
      {
        id: "30000000-0000-4000-8000-000000000004",
        contactId: null,
        bookingId: null,
        kind: "approved_suggestion",
        subject: "Scout Notes",
        body: scoutNoteBody,
        occurredAt: base,
        createdAt: base,
        updatedAt: base,
        importedFromAct: false,
        actSourceType: null,
      },
    ],
    followUps: [],
    groups: [],
    externalLinks: [],
  };
}

describe("event profile timeline classification", () => {
  it("puts local and ACT notes in Notes, ACT history in History, and Scout research in Scout Notes", () => {
    const profile = buildEventProfile(records());

    expect(profile.notes.map((item) => item.body)).toEqual([
      "Local note",
      "EVENT DATES: July 4, 2023",
    ]);
    expect(profile.history.map((item) => item.body)).toEqual(["Called fair office"]);
    expect(profile.scoutNotes).toEqual([
      expect.objectContaining({
        id: "30000000-0000-4000-8000-000000000004",
        fitScore: 88,
        summary: "Strong family fit",
        positives: ["family audience"],
        cautions: ["Confirm that no inflatable provider is already contracted"],
        sources: [expect.objectContaining({ url: "https://example.org/silver-valley-days" })],
      }),
    ]);
  });

  it("does not silently hide a damaged Scout Note from the ordinary Notes timeline", () => {
    const damaged = records();
    damaged.activities = [
      {
        ...damaged.activities[3]!,
        id: "30000000-0000-4000-8000-000000000005",
        body: "not valid JSON",
      },
    ];

    const profile = buildEventProfile(damaged);

    expect(profile.scoutNotes).toEqual([]);
    expect(profile.notes.map((item) => item.body)).toEqual(["not valid JSON"]);
  });
});