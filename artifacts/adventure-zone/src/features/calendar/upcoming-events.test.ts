import { describe, expect, it } from "vitest";
import { calendarEventPublicStart, futureCalendarEvents } from "./upcoming-events";

describe("futureCalendarEvents", () => {
  it("never falls back to past events when nothing remains in the future", () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const events = [
      { id: "burro", startsAt: new Date("2026-07-21T00:00:00.000Z") },
      { id: "uinta", startsAt: new Date("2026-07-26T00:00:00.000Z") },
    ];
    expect(futureCalendarEvents(events, now)).toEqual([]);
  });

  it("keeps an in-progress block plus future blocks", () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const events = [
      { id: "past", startsAt: new Date("2026-08-20T00:00:00.000Z"), endsAt: new Date("2026-08-22T00:00:00.000Z") },
      { id: "in-progress", startsAt: new Date("2026-08-28T00:00:00.000Z"), endsAt: new Date("2026-08-30T00:00:00.000Z") },
      { id: "future", startsAt: new Date("2026-09-10T00:00:00.000Z"), endsAt: new Date("2026-09-13T00:00:00.000Z") },
    ];
    expect(futureCalendarEvents(events, now).map((event) => event.id)).toEqual(["in-progress", "future"]);
  });

  it("uses the public event dates instead of gray travel days for cutoff, order, and grouping", () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const events = [
      {
        id: "past-public-event",
        startsAt: new Date("2026-08-28T00:00:00.000Z"),
        endsAt: new Date("2026-09-01T00:00:00.000Z"),
        actualStartsAt: new Date("2026-08-20T00:00:00.000Z"),
        actualEndsAt: new Date("2026-08-22T00:00:00.000Z"),
      },
      {
        id: "later-travel-start",
        startsAt: new Date("2026-09-03T00:00:00.000Z"),
        endsAt: new Date("2026-09-08T00:00:00.000Z"),
        actualStartsAt: new Date("2026-09-05T00:00:00.000Z"),
        actualEndsAt: new Date("2026-09-07T00:00:00.000Z"),
      },
      {
        id: "earlier-travel-start-but-later-event",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2026-09-12T00:00:00.000Z"),
        actualStartsAt: new Date("2026-09-10T00:00:00.000Z"),
        actualEndsAt: new Date("2026-09-10T00:00:00.000Z"),
      },
    ];

    const upcoming = futureCalendarEvents(events, now);
    expect(upcoming.map((event) => event.id)).toEqual([
      "later-travel-start",
      "earlier-travel-start-but-later-event",
    ]);
    expect(calendarEventPublicStart(upcoming[0]!)).toEqual(new Date("2026-09-05T00:00:00.000Z"));
  });
});
