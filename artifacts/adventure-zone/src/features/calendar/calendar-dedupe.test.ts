import { describe, expect, it } from "vitest";

import { dedupeCalendarBookings } from "./calendar-dedupe";

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    name: "Twin Falls County Fair - 2026",
    city: "Filer",
    region: "ID",
    travelLegId: null,
    startsAt: new Date("2026-09-07T12:00:00Z"),
    endsAt: new Date("2026-09-07T20:00:00Z"),
    status: "new_lead",
    ...overrides,
  } as any;
}

describe("dedupeCalendarBookings", () => {
  it("collapses duplicate event/date records and keeps the more meaningful status", () => {
    const result = dedupeCalendarBookings([
      booking(),
      booking({ id: "booking-2", status: "contacted" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "booking-2", status: "contacted" });
  });

  it("treats leg assignment differences as the same event", () => {
    const result = dedupeCalendarBookings([
      booking(),
      booking({ id: "booking-2", travelLegId: "leg-kristy", status: "contacted" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "booking-2", travelLegId: "leg-kristy" });
  });

  it("prefers a live confirmed booking over a stale terminal duplicate", () => {
    const result = dedupeCalendarBookings([
      booking({ id: "confirmed", status: "confirmed" }),
      booking({ id: "completed", status: "completed" }),
      booking({ id: "declined", status: "declined" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "confirmed", status: "confirmed" });
  });

  it("does not merge same-name events on different dates", () => {
    const result = dedupeCalendarBookings([
      booking(),
      booking({ id: "booking-2", startsAt: new Date("2026-09-08T12:00:00Z"), endsAt: new Date("2026-09-08T20:00:00Z") }),
    ]);

    expect(result).toHaveLength(2);
  });
});
