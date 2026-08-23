import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");

describe("Today page information hierarchy", () => {
  it("organizes the workday around Start here, My Work, Coming up, and Later", () => {
    const startHere = source.indexOf("Start here");
    const myWork = source.indexOf('aria-labelledby="my-work-title"');
    const comingUp = source.indexOf('aria-labelledby="coming-up-title"');
    const later = source.indexOf(">Later<");

    expect(startHere).toBeGreaterThan(-1);
    expect(myWork).toBeGreaterThan(startHere);
    expect(comingUp).toBeGreaterThan(myWork);
    expect(later).toBeGreaterThan(comingUp);
  });

  it("removes aggregate obligation noise from the header", () => {
    expect(source).not.toContain('aria-label="Today summary"');
    expect(source).not.toContain("things need attention");
    expect(source).not.toContain("New leads in queue");
  });

  it("keeps future-looking detail available under Later rather than expanded by default", () => {
    const later = source.indexOf(">Later<");
    expect(source.indexOf("Current & upcoming events", later)).toBeGreaterThan(later);
    expect(source.indexOf("Today's trips", later)).toBeGreaterThan(later);
    expect(source.indexOf("Renewals", later)).toBeGreaterThan(later);
  });
});
