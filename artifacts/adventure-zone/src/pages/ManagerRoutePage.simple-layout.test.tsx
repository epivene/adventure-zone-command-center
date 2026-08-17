import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/ManagerRoutePage.tsx", "utf8");

describe("manager Schedule simple layout", () => {
  it("keeps the schedule read-only and opens event details in a responsive sheet", () => {
    expect(source).toContain("Official schedule · view only");
    expect(source).toContain("ResponsiveDetailSheet");
    expect(source).toContain("ReportScheduleIssue");
    expect(source).not.toContain("Edit booking");
  });

  it("makes the map the primary visual", () => {
    expect(source).toContain('min-h-[44dvh]');
    expect(source.indexOf("ManagerScopedMap")).toBeLessThan(source.indexOf("Scheduled events"));
  });
});
