import { describe, expect, it } from "vitest";

import { dedupeCalendarBookings } from "./calendar-dedupe";

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    name: "Twin Falls County Fair - 2026",
    city: "Filer",
    region: "ID",
    travelLegId: "leg-kristy",
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

  it("does not merge same-name events on different dates or legs", () => {
    const result = dedupeCalendarBookings([
      booking(),
      booking({ id: "booking-2", startsAt: new Date("2026-09-08T12:00:00Z"), endsAt: new Date("2026-09-08T20:00:00Z") }),
      booking({ id: "booking-3", travelLegId: "leg-hulk" }),
    ]);

    expect(result).toHaveLength(3);
  });
});
