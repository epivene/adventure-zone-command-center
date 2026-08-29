import { describe, expect, it } from "vitest";

import { applyOperationalWindowsToCalendarBookings } from "./calendar-operational-window-projection";

describe("applyOperationalWindowsToCalendarBookings", () => {
  it("shows the reserved Google block while preserving the actual public dates", () => {
    const actualStart = new Date("2026-09-12T00:00:00.000Z");
    const actualEnd = new Date("2026-09-12T00:00:00.000Z");
    const reservedStart = new Date("2026-09-10T00:00:00.000Z");
    const reservedEnd = new Date("2026-09-14T00:00:00.000Z");

    const [result] = applyOperationalWindowsToCalendarBookings([
      { id: "booking-1", name: "Blanding City Fall Festival", startsAt: actualStart, endsAt: actualEnd },
    ], [
      { bookingId: "booking-1", startsAt: reservedStart, endsAt: reservedEnd, source: "google_calendar" },
    ]);

    expect(result?.startsAt).toEqual(reservedStart);
    expect(result?.endsAt).toEqual(reservedEnd);
    expect(result?.actualStartsAt).toEqual(actualStart);
    expect(result?.actualEndsAt).toEqual(actualEnd);
    expect(result?.operationalWindowSource).toBe("google_calendar");
  });

  it("leaves ordinary bookings unchanged when no operational window exists", () => {
    const booking = { id: "booking-2", startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: null };
    expect(applyOperationalWindowsToCalendarBookings([booking], [])).toEqual([booking]);
  });
});
