import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const calendarSource = readFileSync("src/components/calendar/event-calendar.tsx", "utf8");

describe("EventCalendar visible month ownership", () => {
  it("derives the visible month from the parent prop instead of keeping a second activeMonth state", () => {
    expect(calendarSource).not.toContain("useState(() => parseMonth(initialMonth))");
    expect(calendarSource).toContain("parseMonth(initialMonth)");
  });

  it("moves a spillover-day click through the parent month callback", () => {
    expect(calendarSource).toContain("onMonthChange?.(monthKey(next))");
    expect(calendarSource).toContain("setSelectedDayKey(key)");
  });
});
