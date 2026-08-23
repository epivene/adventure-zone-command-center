import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const today = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");

describe("Today section heading hierarchy", () => {
  it("keeps the daily workspace focused on a small number of primary sections", () => {
    expect(today).toContain("Start here");
    expect(today).toContain(">My Work<");
    expect(today).toContain(">Coming up<");
    expect(today).toContain(">Later<");
    expect(today).not.toContain(">Up Next<");
    expect(today).not.toContain(">Today's Queue<");
    expect(today).not.toContain('id="needs-attention-title"');
  });
});
