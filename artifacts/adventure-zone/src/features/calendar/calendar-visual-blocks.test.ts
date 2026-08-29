import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCHEDULE_DISPLAY_COLORS,
  bookingVisualKindOnDate,
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

  it("defaults to hot pink for public event days and gray for travel days", () => {
    expect(DEFAULT_SCHEDULE_DISPLAY_COLORS.eventColor).toBe("#ec4899");
    expect(DEFAULT_SCHEDULE_DISPLAY_COLORS.travelColor).toBe("#94a3b8");
  });
});
