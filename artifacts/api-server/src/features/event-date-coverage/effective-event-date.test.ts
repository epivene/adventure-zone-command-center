import { describe, expect, it } from "vitest";

import { resolveEffectiveEventDate } from "./effective-event-date";

describe("resolveEffectiveEventDate", () => {
  it("prefers a future booking over an earlier researched fact", () => {
    expect(resolveEffectiveEventDate({
      today: "2026-09-21",
      bookings: [
        { id: "booking-1", startsOn: "2026-10-03", endsOn: null, status: "confirmed" },
      ],
      facts: [
        { id: "fact-1", startsOn: "2026-09-28", endsOn: null, status: "confirmed", active: true },
      ],
    })).toEqual({
      startsOn: "2026-10-03",
      endsOn: null,
      displayStatus: "booked",
      sourceId: "booking-1",
    });
  });

  it.each([
    {
      name: "selects the earliest eligible booking",
      bookings: [
        { id: "later", startsOn: "2026-11-01", endsOn: null, status: "confirmed" },
        { id: "earlier", startsOn: "2026-10-01", endsOn: "2026-10-03", status: "tentative" },
      ],
      facts: [],
      want: {
        startsOn: "2026-10-01",
        endsOn: "2026-10-03",
        displayStatus: "booked",
        sourceId: "earlier",
      },
    },
    {
      name: "ignores cancelled, declined, and past bookings",
      bookings: [
        { id: "past", startsOn: "2026-09-20", endsOn: null, status: "confirmed" },
        { id: "cancelled", startsOn: "2026-09-22", endsOn: null, status: "cancelled" },
        { id: "declined", startsOn: "2026-09-23", endsOn: null, status: "declined" },
      ],
      facts: [
        { id: "fact", startsOn: "2026-10-04", endsOn: null, status: "expected" as const, active: true },
      ],
      want: {
        startsOn: "2026-10-04",
        endsOn: null,
        displayStatus: "expected",
        sourceId: "fact",
      },
    },
    {
      name: "prefers confirmed facts over earlier expected facts",
      bookings: [],
      facts: [
        { id: "expected", startsOn: "2026-09-22", endsOn: null, status: "expected" as const, active: true },
        { id: "confirmed", startsOn: "2026-10-12", endsOn: null, status: "confirmed" as const, active: true },
      ],
      want: {
        startsOn: "2026-10-12",
        endsOn: null,
        displayStatus: "confirmed",
        sourceId: "confirmed",
      },
    },
    {
      name: "treats today as a future date boundary",
      bookings: [],
      facts: [
        { id: "today", startsOn: "2026-09-21", endsOn: null, status: "confirmed" as const, active: true },
      ],
      want: {
        startsOn: "2026-09-21",
        endsOn: null,
        displayStatus: "confirmed",
        sourceId: "today",
      },
    },
    {
      name: "excludes inactive and needs-review facts",
      bookings: [],
      facts: [
        { id: "review", startsOn: "2026-09-22", endsOn: null, status: "needs_review" as const, active: true },
        { id: "inactive", startsOn: "2026-09-23", endsOn: null, status: "confirmed" as const, active: false },
      ],
      want: null,
    },
    {
      name: "excludes malformed calendar dates",
      bookings: [
        { id: "invalid", startsOn: "2026-13-40", endsOn: null, status: "confirmed" },
      ],
      facts: [],
      want: null,
    },
  ])("$name", ({ bookings, facts, want }) => {
    expect(resolveEffectiveEventDate({
      today: "2026-09-21",
      bookings,
      facts,
    })).toEqual(want);
  });
});
