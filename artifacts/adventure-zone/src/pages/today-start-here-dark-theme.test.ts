import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const today = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");

describe("Today Start Here theme surface", () => {
  it("uses the theme-aware orange surface instead of the unhandled translucent variant", () => {
    expect(today).toContain("bg-orange-50");
    expect(today).not.toContain("bg-orange-50/70");
  });
});
