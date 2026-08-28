import { describe, expect, it } from "vitest";

import {
  matchOperationalCalendarEvent,
  parseOperationalEventDateText,
} from "./operational-calendar-matcher";

const candidate = {
  bookingId: "booking-1",
  organizationId: "org-1",
  name: "Blanding City Fall Festival",
  city: "Blanding",
  region: "UT",
  startsAt: new Date("2026-09-12T00:00:00.000Z"),
  endsAt: new Date("2026-09-12T00:00:00.000Z"),
  travelLegName: "Mikey",
};

describe("operational calendar matcher", () => {
  it("matches the Blanding calendar row to the existing profile instead of duplicating it", () => {
    expect(matchOperationalCalendarEvent({
      eventName: "Blanding City Fall Festival",
      city: "Blanding",
      region: "UT",
      actualStartsAt: new Date("2026-09-12T00:00:00.000Z"),
      actualEndsAt: new Date("2026-09-12T00:00:00.000Z"),
      managerToken: "MIKEY",
      candidates: [candidate],
    })).toMatchObject({ kind: "matched", bookingId: "booking-1", confidence: "high" });
  });

  it("stops for review when two existing profiles are equally plausible", () => {
    const result = matchOperationalCalendarEvent({
      eventName: "County Fair",
      city: "Delta",
      region: "UT",
      actualStartsAt: new Date("2026-08-05T00:00:00.000Z"),
      actualEndsAt: new Date("2026-08-08T00:00:00.000Z"),
      managerToken: null,
      candidates: [
        { ...candidate, bookingId: "a", organizationId: "oa", name: "County Fair", city: "Delta", startsAt: new Date("2026-08-05T00:00:00Z"), endsAt: new Date("2026-08-08T00:00:00Z"), travelLegName: null },
        { ...candidate, bookingId: "b", organizationId: "ob", name: "County Fair", city: "Delta", startsAt: new Date("2026-08-05T00:00:00Z"), endsAt: new Date("2026-08-08T00:00:00Z"), travelLegName: null },
      ],
    });
    expect(result).toEqual({
      kind: "review",
      candidateBookingIds: ["a", "b"],
      reason: "More than one existing event profile is a plausible calendar match.",
    });
  });

  it("parses screenshot-style EVENT DATES without inventing a separate year", () => {
    expect(parseOperationalEventDateText("Saturday, September 12th", 2026)).toEqual({
      startsAt: new Date("2026-09-12T00:00:00.000Z"),
      endsAt: new Date("2026-09-12T00:00:00.000Z"),
    });
  });
});
