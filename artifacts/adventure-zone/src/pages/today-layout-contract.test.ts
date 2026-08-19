import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");

describe("Today page information hierarchy", () => {
  it("organizes the workday around Up Next, queue, attention, and coming up", () => {
    const upNext = source.indexOf('aria-labelledby="up-next-title"');
    const queue = source.indexOf('aria-labelledby="today-queue-title"');
    const attention = source.indexOf('aria-labelledby="needs-attention-title"');
    const comingUp = source.indexOf('aria-labelledby="coming-up-title"');

    expect(upNext).toBeGreaterThan(-1);
    expect(queue).toBeGreaterThan(upNext);
    expect(attention).toBeGreaterThan(queue);
    expect(comingUp).toBeGreaterThan(attention);
  });

  it("uses compact workload summary pills instead of another full stats panel", () => {
    expect(source).toContain('aria-label="Today summary"');
    expect(source).toContain("Overdue");
    expect(source).toContain("Contracts");
    expect(source).toContain("New leads");
    expect(source).toContain("things need attention");
  });

  it("groups future-looking material under Coming Up", () => {
    const comingUp = source.indexOf('aria-labelledby="coming-up-title"');
    expect(source.indexOf("Upcoming events", comingUp)).toBeGreaterThan(comingUp);
    expect(source.indexOf("Today's trips", comingUp)).toBeGreaterThan(comingUp);
    expect(source.indexOf("Renewals", comingUp)).toBeGreaterThan(comingUp);
    expect(source).not.toContain("More for later");
  });
});
