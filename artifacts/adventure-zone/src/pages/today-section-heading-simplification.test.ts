import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const today = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");

describe("Today section heading hierarchy", () => {
  it("uses one primary heading per section without duplicate eyebrow labels", () => {
    expect(today).toContain(">Up Next<");
    expect(today).toContain(">Today's Queue<");
    expect(today).toContain(">Needs Attention<");
    expect(today).toContain(">Coming Up<");
    expect(today).not.toContain("Do this first");
    expect(today).not.toContain("Keep moving");
    expect(today).not.toContain("Exceptions");
    expect(today).not.toContain("Awareness, not urgency");
  });
});
