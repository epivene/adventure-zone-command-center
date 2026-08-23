import { describe, expect, it } from "vitest";

import { buildEventProfile, type EventProfileRecordSet } from "./event-profile-repository";

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
    ],
    followUps: [],
    groups: [],
    externalLinks: [],
  };
}

describe("event profile ACT timeline classification", () => {
  it("puts local and ACT notes in Notes while ACT history stays in History", () => {
    const profile = buildEventProfile(records());

    expect(profile.notes.map((item) => item.body)).toEqual([
      "Local note",
      "EVENT DATES: July 4, 2023",
    ]);
    expect(profile.history.map((item) => item.body)).toEqual(["Called fair office"]);
  });
});
