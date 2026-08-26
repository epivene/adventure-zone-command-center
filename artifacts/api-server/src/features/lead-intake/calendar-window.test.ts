import { describe, expect, it } from "vitest";
import { normalizeCalendarWindow } from "./calendar-window";

describe("normalizeCalendarWindow", () => {
  it("converts exclusive Google all-day end dates into an inclusive occupied window", () => {
    expect(normalizeCalendarWindow({ kind: "google", start: { date: "2026-09-10" }, end: { date: "2026-09-14" }, calendarTimeZone: "America/Chicago" }))
      .toEqual({ startDate: "2026-09-08", endDate: "2026-09-13" });
  });
  it("uses the event time zone instead of the server time zone for timed events", () => {
    expect(normalizeCalendarWindow({ kind: "google", start: { dateTime: "2026-09-10T00:30:00Z", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-09-11T03:30:00Z", timeZone: "America/Los_Angeles" }, calendarTimeZone: "America/Chicago" }))
      .toEqual({ startDate: "2026-09-07", endDate: "2026-09-11" });
  });
  it("keeps internally buffered booking entries exact", () => {
    expect(normalizeCalendarWindow({ kind: "stored_booking", start: { date: "2026-09-08" }, end: { date: "2026-09-13" }, calendarTimeZone: "America/Chicago" }))
      .toEqual({ startDate: "2026-09-08", endDate: "2026-09-13" });
  });
});