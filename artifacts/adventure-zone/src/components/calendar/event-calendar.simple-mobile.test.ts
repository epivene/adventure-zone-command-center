import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const calendarSource = readFileSync("src/components/calendar/event-calendar.tsx", "utf8");
const pageSource = readFileSync("src/pages/CalendarPage.tsx", "utf8");

describe("simplified calendar contracts", () => {
  it("passes the currently selected month back into EventCalendar", () => {
    expect(pageSource).toContain("initialMonth={activeMonth}");
    expect(pageSource).not.toContain("initialMonth={initialMonth} onMonthChange");
  });

  it("uses a compact mobile month grid and selected-day details", () => {
    expect(calendarSource).toContain('className="grid grid-cols-7 gap-px bg-slate-200"');
    expect(calendarSource).toContain("selectedDayKey");
    expect(calendarSource).toContain("initialSelectedDay");
    expect(calendarSource).toContain("Nothing scheduled for this day.");
  });

  it("supports repeated month navigation plus a Today jump", () => {
    expect(calendarSource).toContain('aria-label="Previous month"');
    expect(calendarSource).toContain('aria-label="Next month"');
    expect(calendarSource).toContain("function goToday()");
    expect(calendarSource).toContain("onMonthChange?.(monthKey(next))");
  });

  it("keeps imported activity hidden by default under More and makes the alternate view Upcoming", () => {
    expect(calendarSource).toContain("useState(false)");
    expect(calendarSource).toContain("More ▾");
    expect(calendarSource).toContain("Show imported ACT activity");
    expect(calendarSource).toContain(">Upcoming<");
    expect(calendarSource).toContain(">Show more<");
  });

});
