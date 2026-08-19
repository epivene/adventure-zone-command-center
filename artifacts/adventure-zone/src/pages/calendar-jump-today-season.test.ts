import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schedule = fs.readFileSync(path.resolve(__dirname, "SchedulePage.tsx"), "utf8");
const calendarPage = fs.readFileSync(path.resolve(__dirname, "CalendarPage.tsx"), "utf8");

describe("Calendar jump to today season sync", () => {
  it("keeps the schedule season aligned with the visible calendar year", () => {
    expect(calendarPage).toContain("onVisibleMonthChange");
    expect(calendarPage).toContain("onVisibleMonthChange?.(month)");
    expect(schedule).toContain("handleCalendarMonthChange");
    expect(schedule).toContain("const visibleSeason = month.slice(0, 4)");
    expect(schedule).toContain("setSeason(visibleSeason)");
    expect(schedule).toContain("syncUrl({ season: visibleSeason })");
    expect(schedule).toContain("onVisibleMonthChange={handleCalendarMonthChange}");
  });
});
