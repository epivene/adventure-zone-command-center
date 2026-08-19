import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(path.resolve(__dirname, "profile-research-intake.ts"), "utf8");

describe("Source Scout bulk intake route", () => {
  it("exposes a bounded owner-only bulk prospect creation endpoint", () => {
    expect(route).toContain('/profile-research/bulk-intake');
    expect(route).toContain('events: z.array');
    expect(route).toContain('.max(20)');
    expect(route).toContain('ProfileResearchBulkIntakeService');
    expect(route).toContain('nextActionDueAt');
  });
});
