import { describe, expect, it } from "vitest";

import { applyOperationalWindowsToCalendarBookings } from "./calendar-operational-window-projection";

describe("applyOperationalWindowsToCalendarBookings", () => {
  it("shows the reserved Google block while preserving the actual public dates", () => {
    const actualStart = new Date("2026-09-12T00:00:00.000Z");
    const actualEnd = new Date("2026-09-12T00:00:00.000Z");
    const reservedStart = new Date("2026-09-10T00:00:00.000Z");
    const reservedEndExclusive = new Date("2026-09-14T00:00:00.000Z");

    const [result] = applyOperationalWindowsToCalendarBookings([
      { id: "booking-1", name: "Blanding City Fall Festival", startsAt: actualStart, endsAt: actualEnd },
    ], [
      { bookingId: "booking-1", startsAt: reservedStart, endsAt: reservedEndExclusive, source: "google_calendar" },
    ]);

    expect(result?.startsAt).toEqual(reservedStart);
    expect(result?.endsAt).toEqual(new Date("2026-09-13T00:00:00.000Z"));
    expect(result?.actualStartsAt).toEqual(actualStart);
    expect(result?.actualEndsAt).toEqual(actualEnd);
    expect(result?.operationalWindowSource).toBe("google_calendar");
  });

  it("creates the app-owned travel/setup window for a definite Contract Received booking", () => {
    const actualStart = new Date("2026-09-05T00:00:00.000Z");
    const actualEnd = new Date("2026-09-07T00:00:00.000Z");

    const [result] = applyOperationalWindowsToCalendarBookings([
      {
        id: "meeteetse",
        name: "Meeteetse Annual Labor Day Celebration 2026",
        status: "contract_received",
        probability: "definite",
        startsAt: actualStart,
        endsAt: actualEnd,
      },
    ], []);

    expect(result?.startsAt).toEqual(new Date("2026-09-03T00:00:00.000Z"));
    expect(result?.endsAt).toEqual(new Date("2026-09-08T00:00:00.000Z"));
    expect(result?.actualStartsAt).toEqual(actualStart);
    expect(result?.actualEndsAt).toEqual(actualEnd);
    expect(result?.operationalWindowSource).toBe("app");
  });

  it("does not create an operational block for an ordinary possible booking", () => {
    const booking = {
      id: "possible-booking",
      status: "possible",
      probability: "possible",
      startsAt: new Date("2026-10-01T00:00:00.000Z"),
      endsAt: new Date("2026-10-02T00:00:00.000Z"),
    };
    expect(applyOperationalWindowsToCalendarBookings([booking], [])).toEqual([booking]);
  });

  it("leaves ordinary bookings unchanged when no operational window exists", () => {
    const booking = { id: "booking-2", startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: null };
    expect(applyOperationalWindowsToCalendarBookings([booking], [])).toEqual([booking]);
  });
});
