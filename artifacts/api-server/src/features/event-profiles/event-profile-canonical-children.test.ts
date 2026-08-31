import { describe, expect, it } from "vitest";

import { buildEventProfile, type EventProfileRecordSet } from "./event-profile-repository";

const profileId = "f24033e1-801b-43ff-9a7e-a9d6d7b426c3";
const canonicalContactId = "4f8499d3-9d1c-4799-8bba-91cb91965963";
const actContactId = "603ecc6a-7e90-45d5-b017-eb28b50caee9";
const canonicalBookingId = "cd7ce3ca-7370-47a3-9f07-0ca617e03695";

function records(): EventProfileRecordSet {
  const duplicateContacts = Array.from({ length: 15 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    firstName: "Michael",
    lastName: "Ringling",
    role: "Events Specialist",
    isPrimary: false,
    phone: "720-955-3603",
    email: "mringling@northglenn.org",
    source: "local",
    actRecordId: null,
    locationName: null,
    locationCity: null,
    locationRegion: null,
  }));
  const duplicateBookings = Array.from({ length: 15 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: "Pirate Fest - 2026",
    primaryContactId: duplicateContacts[index]!.id,
    city: "Northglenn",
    region: "CO",
    startsAt: null,
    endsAt: null,
    status: "completed",
    probability: "unlikely",
    notes: `[Merged duplicate] Canonical booking: ${canonicalBookingId}`,
    actRecordId: null,
  }));

  return {
    place: {
      id: profileId,
      name: "Pirate Fest, The (Northglenn) CO",
      placeType: "festival_event",
      phone: "303-450-8935",
      address1: null,
      address2: null,
      city: "Northglenn",
      region: "CO",
      postalCode: "80233",
      website: "https://thepiratefest.com/",
      lastResort: false,
      lastResortReason: null,
      actRecordId: "bedcf05e-0605-4c52-afe3-27fa1bb1d583",
    },
    contacts: [
      {
        id: canonicalContactId,
        firstName: "Michael",
        lastName: "Ringling",
        role: "Events Specialist",
        isPrimary: true,
        phone: "720-955-3603",
        email: "mringling@northglenn.org",
        source: "local",
        actRecordId: null,
        locationName: null,
        locationCity: null,
        locationRegion: null,
      },
      {
        id: actContactId,
        firstName: "Michael",
        lastName: "Ringling",
        role: null,
        isPrimary: false,
        phone: "3034508935",
        email: "mringling@northglenn.org",
        source: "legacy_backfill",
        actRecordId: "9763896c-4ff0-4ca0-bf92-de0875785120",
        locationName: null,
        locationCity: null,
        locationRegion: null,
      },
      ...duplicateContacts,
    ],
    bookings: [
      {
        id: canonicalBookingId,
        name: "Pirate Fest - 2026",
        primaryContactId: canonicalContactId,
        city: "Northglenn",
        region: "CO",
        startsAt: new Date("2026-09-18T17:00:00.000Z"),
        endsAt: new Date("2026-09-19T17:00:00.000Z"),
        status: "pending_decision",
        probability: "possible",
        notes: null,
        actRecordId: null,
      },
      ...duplicateBookings,
    ],
    activities: [],
    followUps: [],
    groups: [],
    externalLinks: [],
  };
}

describe("canonical profile children", () => {
  it("shows one Michael Ringling contact and preserves the primary direct number plus ACT provenance", () => {
    const profile = buildEventProfile(records(), actContactId);

    expect(profile.contacts).toHaveLength(1);
    expect(profile.contacts[0]).toMatchObject({
      id: canonicalContactId,
      name: "Michael Ringling",
      isPrimary: true,
      phone: "720-955-3603",
      email: "mringling@northglenn.org",
      actRecordId: "9763896c-4ff0-4ca0-bf92-de0875785120",
    });
    expect(profile.selectedContactId).toBe(canonicalContactId);
  });

  it("hides retired merged rows and exposes one canonical appearance for 2026", () => {
    const profile = buildEventProfile(records());

    expect(profile.bookings).toHaveLength(1);
    expect(profile.bookings[0]).toMatchObject({
      id: canonicalBookingId,
      name: "Pirate Fest - 2026",
      startsAt: new Date("2026-09-18T17:00:00.000Z"),
    });
  });

  it("preserves distinct appearances that happen in the same year", () => {
    const input = records();
    input.bookings.push({
      id: "30000000-0000-4000-8000-000000000001",
      name: "Northglenn July 4 Celebration - 2026",
      primaryContactId: canonicalContactId,
      city: "Northglenn",
      region: "CO",
      startsAt: new Date("2026-07-04T17:00:00.000Z"),
      endsAt: new Date("2026-07-04T23:00:00.000Z"),
      status: "interested",
      probability: "possible",
      notes: null,
      actRecordId: null,
    });

    const profile = buildEventProfile(input);

    expect(profile.bookings.map((booking) => booking.id)).toEqual([
      canonicalBookingId,
      "30000000-0000-4000-8000-000000000001",
    ]);
  });

  it("rewrites child references to their canonical contact and appearance", () => {
    const input = records();
    const duplicateContactId = input.contacts[2]!.id;
    const duplicateBookingId = input.bookings[1]!.id;
    input.activities.push({
      id: "40000000-0000-4000-8000-000000000001",
      contactId: duplicateContactId,
      bookingId: duplicateBookingId,
      kind: "note",
      subject: "Duplicate-linked note",
      body: "Preserve this history on the canonical profile children.",
      occurredAt: new Date("2026-08-29T12:00:00.000Z"),
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
      updatedAt: new Date("2026-08-29T12:00:00.000Z"),
      importedFromAct: false,
      actSourceType: null,
    });
    input.followUps.push({
      id: "50000000-0000-4000-8000-000000000001",
      contactId: duplicateContactId,
      bookingId: duplicateBookingId,
      kind: "Follow up in 2027",
      dueAt: new Date("2027-01-15T15:00:00.000Z"),
      completedAt: null,
    });

    const profile = buildEventProfile(input);

    expect(profile.notes[0]).toMatchObject({
      contactId: canonicalContactId,
      bookingId: canonicalBookingId,
    });
    expect(profile.followUps[0]).toMatchObject({
      contactId: canonicalContactId,
      bookingId: canonicalBookingId,
    });
    expect(profile.bookings[0]!.primaryContactId).toBe(canonicalContactId);
  });
});
