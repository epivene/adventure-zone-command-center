import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schedule = fs.readFileSync(path.resolve(__dirname, "SchedulePage.tsx"), "utf8");
const calendarPage = fs.readFileSync(path.resolve(__dirname, "CalendarPage.tsx"), "utf8");
const eventCalendar = fs.readFileSync(path.resolve(__dirname, "../components/calendar/event-calendar.tsx"), "utf8");

describe("Calendar jump to today season sync", () => {
  it("resets the schedule season to today's year when Jump to today is used", () => {
    expect(eventCalendar).toContain("onJumpToToday");
    expect(calendarPage).toContain("onJumpToToday={onJumpToToday}");
    expect(schedule).toContain("handleJumpToToday");
    expect(schedule).toContain("setSeason(todaySeason)");
    expect(schedule).toContain("syncUrl({ season: todaySeason })");
    expect(schedule).toContain("onJumpToToday={handleJumpToToday}");
  });
});
