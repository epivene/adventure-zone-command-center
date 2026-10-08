import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/TodayPage.tsx", "utf8");

describe("Today simplified daily workspace", () => {
  it("centers the page on one queue and selected next action", () => {
    expect(source).toContain("<DailyWorkspace");
    expect(source).toContain("managementOnly");
    expect(source).toContain("Coming up");
    expect(source).toContain("Schedule &amp; renewals");
  });

  it("does not keep the old competing dashboard section hierarchy", () => {
    expect(source).not.toContain("Today's Queue");
    expect(source).not.toContain('id="needs-attention-title"');
  });

  it("keeps exceptional route warnings conditional instead of showing zero-state noise", () => {
    expect(source).toContain("visibleRouteWarningCount > 0");
  });

  it("keeps schedule access and existing lower-frequency work available", () => {
    expect(source).toContain('href="/schedule"');
    expect(source).toContain("RenewalsSection");
    expect(source).toContain("todayTrips");
  });
});
