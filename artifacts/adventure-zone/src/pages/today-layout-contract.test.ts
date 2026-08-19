import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");

describe("Today page information hierarchy", () => {
  it("organizes the workday around Up Next, queue, attention, and coming up", () => {
    expect(source).toContain("Today's Queue");
    expect(source).toContain("Needs Attention");
    expect(source).toContain("Coming Up");

    const upNext = source.indexOf("Up Next");
    const queue = source.indexOf("Today's Queue");
    const attention = source.indexOf("Needs Attention");
    const comingUp = source.indexOf("Coming Up");

    expect(upNext).toBeGreaterThan(-1);
    expect(queue).toBeGreaterThan(upNext);
    expect(attention).toBeGreaterThan(queue);
    expect(comingUp).toBeGreaterThan(attention);
  });

  it("uses compact workload summary pills instead of another full stats panel", () => {
    expect(source).toContain("Overdue");
    expect(source).toContain("Contracts");
    expect(source).toContain("New leads");
    expect(source).toContain("things need attention");
  });

  it("groups future-looking material under Coming Up", () => {
    expect(source).toContain("Upcoming events");
    expect(source).toContain("Today's trips");
    expect(source).toContain("Renewals");
    expect(source).not.toContain("More for later");
  });
});
