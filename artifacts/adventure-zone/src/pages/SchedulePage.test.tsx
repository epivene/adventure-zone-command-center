import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scheduleSource = readFileSync("src/pages/SchedulePage.tsx", "utf8");
const calendarSource = readFileSync("src/pages/CalendarPage.tsx", "utf8");
const routesSource = readFileSync("src/pages/RoutesPage.tsx", "utf8");

describe("combined Schedule workspace", () => {
  it("offers Calendar and Map views with shared filters", () => {
    expect(scheduleSource).toContain("ScheduleViewToggle");
    expect(scheduleSource).toContain('aria-label="Season"');
    expect(scheduleSource).toContain('aria-label="Leg"');
    expect(scheduleSource).toContain('aria-label="Status"');
    expect(scheduleSource).toContain('<CalendarContent embedded');
    expect(scheduleSource).toContain('<RoutesContent embedded');
  });

  it("passes shared filters into both schedule views", () => {
    expect(calendarSource).toContain("legId?: string");
    expect(calendarSource).toContain("status?: string");
    expect(routesSource).toContain("legId?: string");
    expect(routesSource).toContain("status?: string");
  });
});
