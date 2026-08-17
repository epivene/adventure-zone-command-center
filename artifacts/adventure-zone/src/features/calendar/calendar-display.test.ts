import { describe, expect, it } from "vitest";
import { calendarInitialMonth, normalizeCalendarBookingDates } from "./calendar-display";

describe("calendar display helpers", () => {
  it("opens the current season on today's month instead of January", () => {
    expect(calendarInitialMonth("2026", "2026-08-17")).toBe("2026-08");
    expect(calendarInitialMonth("2025", "2026-08-17")).toBe("2025-01");
  });

  it("does not treat ACT/open-ended sentinel dates as real multi-month event spans", () => {
    const event = normalizeCalendarBookingDates({
      startsAt: new Date("2026-06-12T00:00:00.000Z"),
      endsAt: new Date("9999-12-30T00:00:00.000Z"),
    });

    expect(event.startsAt?.toISOString().slice(0, 10)).toBe("2026-06-12");
    expect(event.endsAt).toBeNull();
  });

  it("preserves normal multi-day event end dates", () => {
    const event = normalizeCalendarBookingDates({
      startsAt: new Date("2026-06-12T00:00:00.000Z"),
      endsAt: new Date("2026-06-14T00:00:00.000Z"),
    });
    expect(event.endsAt?.toISOString().slice(0, 10)).toBe("2026-06-14");
  });
});
