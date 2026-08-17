import { describe, expect, it } from "vitest";

import { buildEventProfile } from "./event-profile-repository";

const occurredAt = new Date("2026-05-10T18:30:00.000Z");

function recordsWithActivities(activities: Array<Record<string, unknown>>) {
  return {
    place: {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Example Event",
      placeType: "event",
      phone: null,
      address1: null,
      address2: null,
      city: "Denver",
      region: "CO",
      postalCode: null,
      website: null,
      lastResort: false,
      lastResortReason: null,
      actRecordId: null,
    },
    contacts: [],
    bookings: [],
    activities,
    followUps: [],
    groups: [],
    externalLinks: [],
  } as any;
}

function activity(input: {
  id: string;
  body: string;
  importedFromAct: boolean;
  actSourceType: "note" | "history" | null;
}) {
  return {
    id: input.id,
    contactId: null,
    bookingId: null,
    kind: "note",
    body: input.body,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    importedFromAct: input.importedFromAct,
    actSourceType: input.actSourceType,
  };
}

describe("ACT notes on event profiles", () => {
  it("shows an exact ACT text/timestamp duplicate only once", () => {
    const profile = buildEventProfile(recordsWithActivities([
      activity({
        id: "20000000-0000-4000-8000-000000000001",
        body: "Called organizer and sent the package.",
        importedFromAct: true,
        actSourceType: "note",
      }),
      activity({
        id: "20000000-0000-4000-8000-000000000002",
        body: "Called organizer and sent the package.",
        importedFromAct: true,
        actSourceType: "history",
      }),
    ]));

    expect(profile.notes).toHaveLength(1);
    expect(profile.notes[0]?.body).toBe("Called organizer and sent the package.");
  });

  it("does not collapse two local notes just because their text and timestamp match", () => {
    const profile = buildEventProfile(recordsWithActivities([
      activity({
        id: "30000000-0000-4000-8000-000000000001",
        body: "Called organizer and sent the package.",
        importedFromAct: false,
        actSourceType: null,
      }),
      activity({
        id: "30000000-0000-4000-8000-000000000002",
        body: "Called organizer and sent the package.",
        importedFromAct: false,
        actSourceType: null,
      }),
    ]));

    expect(profile.notes).toHaveLength(2);
  });
});
