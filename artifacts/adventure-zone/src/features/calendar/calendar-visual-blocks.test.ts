import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCHEDULE_DISPLAY_COLORS,
  bookingVisualKindOnDate,
  calendarBookingLabel,
  colorForBookingDay,
} from "./calendar-visual-blocks";

describe("bookingVisualKindOnDate", () => {
  const booking = {
    startsAt: new Date("2026-09-10T00:00:00.000Z"),
    endsAt: new Date("2026-09-13T00:00:00.000Z"),
    actualStartsAt: new Date("2026-09-12T00:00:00.000Z"),
    actualEndsAt: new Date("2026-09-12T00:00:00.000Z"),
    operationalWindowSource: "google_calendar",
  };

  it("marks reserved days around the public event as travel and the actual event day as event", () => {
    expect(bookingVisualKindOnDate(booking, "2026-09-10")).toBe("travel");
    expect(bookingVisualKindOnDate(booking, "2026-09-11")).toBe("travel");
    expect(bookingVisualKindOnDate(booking, "2026-09-12")).toBe("event");
    expect(bookingVisualKindOnDate(booking, "2026-09-13")).toBe("travel");
    expect(bookingVisualKindOnDate(booking, "2026-09-14")).toBeNull();
  });

  it("treats ordinary bookings without a separate operational window as event days", () => {
    const ordinary = {
      startsAt: new Date("2026-10-03T00:00:00.000Z"),
      endsAt: new Date("2026-10-04T00:00:00.000Z"),
    };
    expect(bookingVisualKindOnDate(ordinary, "2026-10-03")).toBe("event");
    expect(bookingVisualKindOnDate(ordinary, "2026-10-04")).toBe("event");
  });

  it("uses the assigned leg color for event days and translucent gray for travel days", () => {
    const legBooking = { ...booking, travelLegColor: "#7c3aed" };
    expect(colorForBookingDay(legBooking, "2026-09-12", DEFAULT_SCHEDULE_DISPLAY_COLORS)).toBe("#7c3aed");
    expect(colorForBookingDay(legBooking, "2026-09-11", DEFAULT_SCHEDULE_DISPLAY_COLORS)).toBe("rgba(100, 116, 139, 0.42)");
  });
});

describe("calendarBookingLabel", () => {
  it("puts the uppercase leg first and shortens common fair names", () => {
    expect(calendarBookingLabel({ name: "Uinta County Fair", travelLegName: "Kristy" })).toBe("KRISTY • Uinta");
  });

  it("keeps the event name when a booking has no leg", () => {
    expect(calendarBookingLabel({ name: "Burro Days", travelLegName: null })).toBe("Burro Days");
  });
});
