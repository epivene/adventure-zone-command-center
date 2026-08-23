import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const today = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");
const themes = fs.readFileSync(path.resolve(__dirname, "../appearance-themes.css"), "utf8");

describe("Today Start Here dark theme surface", () => {
  it("maps the translucent orange Start Here background to a dark-safe surface", () => {
    expect(today).toContain("bg-orange-50/70");
    expect(themes).toContain("html.dark .bg-orange-50\\/70");
  });
});
