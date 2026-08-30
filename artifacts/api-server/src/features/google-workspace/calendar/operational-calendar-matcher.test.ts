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
  it.each(["ANGEL", "DAVE", "HULK", "KRISTY"] as const)(
    "uses the same reliable event, location, date, and manager evidence for %s",
    (managerToken) => {
      expect(matchOperationalCalendarEvent({
        eventName: candidate.name,
        city: candidate.city,
        region: candidate.region,
        actualStartsAt: candidate.startsAt,
        actualEndsAt: candidate.endsAt,
        managerToken,
        candidates: [{ ...candidate, travelLegName: managerToken }],
      })).toMatchObject({ kind: "matched", bookingId: "booking-1", confidence: "high" });
    },
  );

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

  it("does not match on an exact title without corroborating location or date evidence", () => {
    expect(matchOperationalCalendarEvent({
      eventName: candidate.name,
      city: "Elsewhere",
      region: "CO",
      actualStartsAt: new Date("2027-01-01T00:00:00.000Z"),
      actualEndsAt: new Date("2027-01-02T00:00:00.000Z"),
      managerToken: "MIKEY",
      candidates: [candidate],
    })).toEqual({ kind: "new" });
  });

  it("matches a stale imported booking when a strong identity and one corroborating field remain", () => {
    expect(matchOperationalCalendarEvent({
      eventName: candidate.name,
      city: candidate.city,
      region: candidate.region,
      actualStartsAt: new Date("2026-09-12T00:00:00.000Z"),
      actualEndsAt: new Date("2026-09-12T00:00:00.000Z"),
      managerToken: "MIKEY",
      candidates: [{
        ...candidate,
        startsAt: null,
        endsAt: null,
        travelLegName: null,
      }],
    })).toMatchObject({ kind: "matched", bookingId: "booking-1" });
  });

  it("does not reject a clear identity when an imported location component is absent", () => {
    expect(matchOperationalCalendarEvent({
      eventName: candidate.name,
      city: candidate.city,
      region: candidate.region,
      actualStartsAt: candidate.startsAt,
      actualEndsAt: candidate.endsAt,
      managerToken: "MIKEY",
      candidates: [{
        ...candidate,
        city: "",
        region: candidate.region,
        startsAt: null,
        endsAt: null,
        travelLegName: null,
      }],
    })).toMatchObject({ kind: "matched", bookingId: "booking-1" });
  });

  it("does not match a same-name booking assigned to a different manager", () => {
    expect(matchOperationalCalendarEvent({
      eventName: candidate.name,
      city: candidate.city,
      region: candidate.region,
      actualStartsAt: candidate.startsAt,
      actualEndsAt: candidate.endsAt,
      managerToken: "ANGEL",
      candidates: [{ ...candidate, travelLegName: "DAVE" }],
    })).toEqual({ kind: "new" });
  });

  it("does not match on title and region when city or dates disagree", () => {
    expect(matchOperationalCalendarEvent({
      eventName: candidate.name,
      city: "Elsewhere",
      region: candidate.region,
      actualStartsAt: candidate.startsAt,
      actualEndsAt: candidate.endsAt,
      managerToken: "MIKEY",
      candidates: [candidate],
    })).toEqual({ kind: "new" });

    expect(matchOperationalCalendarEvent({
      eventName: candidate.name,
      city: candidate.city,
      region: candidate.region,
      actualStartsAt: new Date("2027-09-12T00:00:00.000Z"),
      actualEndsAt: new Date("2027-09-12T00:00:00.000Z"),
      managerToken: "MIKEY",
      candidates: [candidate],
    })).toEqual({ kind: "new" });
  });

  it("parses screenshot-style EVENT DATES without inventing a separate year", () => {
    expect(parseOperationalEventDateText("Saturday, September 12th", 2026)).toEqual({
      startsAt: new Date("2026-09-12T00:00:00.000Z"),
      endsAt: new Date("2026-09-12T00:00:00.000Z"),
    });
  });
});
