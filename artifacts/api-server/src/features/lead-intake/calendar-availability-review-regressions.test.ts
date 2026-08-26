import { describe, expect, it } from "vitest";
import { classifyCalendarBooking } from "./calendar-booking-classifier";
import { normalizeStoredCalendarWindow, proposedBookingWindow } from "./calendar-window";

describe("calendar availability review regressions", () => {
  it("keeps stored all-day Google entries exact except for exclusive-end conversion", () => {
    expect(normalizeStoredCalendarWindow({ start: { date: "2026-09-08" }, end: { date: "2026-09-14" }, calendarTimeZone: "America/Chicago" }))
      .toEqual({ startDate: "2026-09-08", endDate: "2026-09-13" });
    expect(proposedBookingWindow({ startDate: "2026-09-10", endDate: "2026-09-12" }))
      .toEqual({ startDate: "2026-09-08", endDate: "2026-09-13" });
  });
  it.each([
    ["Foam Party", "bare package"],
    ["maybe 2 Foam Party", "conditional package"],
    ["no 2 Foam Party", "negative package"],
    ["2 Foam Party or 1 Glow Zone", "alternative package"],
  ])("fails closed on %s", (summary) => {
    expect(classifyCalendarBooking({ summary, description: "" }).confidence).toBe("ambiguous");
  });
  it("treats repeated quantities as corroboration and conflicting quantities as ambiguous", () => {
    expect(classifyCalendarBooking({ summary: "2 Foam Party", description: "2 Foam Party packages" }))
      .toMatchObject({ confidence: "explicit", packages: [{ packageKey: "foam-party", quantity: 2 }] });
    expect(classifyCalendarBooking({ summary: "2 Foam Party", description: "3 Foam Party packages" }).confidence).toBe("ambiguous");
  });
});