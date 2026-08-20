import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const controlFixes = fs.readFileSync(path.resolve(__dirname, "selection-control-fixes.css"), "utf8");
const mainSource = fs.readFileSync(path.resolve(__dirname, "main.tsx"), "utf8");
const todaySource = fs.readFileSync(path.resolve(__dirname, "pages/TodayPage.tsx"), "utf8");

describe("app-wide selection control layout", () => {
  it("keeps checkboxes and radios compact instead of inheriting text-input sizing", () => {
    expect(mainSource).toContain("./selection-control-fixes.css");
    expect(controlFixes).toContain("input[type='checkbox']");
    expect(controlFixes).toContain("input[type='radio']");
    expect(controlFixes).toContain("min-height: 1rem");
    expect(controlFixes).toContain("width: 1rem");
    expect(controlFixes).toContain("height: 1rem");
    expect(controlFixes).toContain("padding: 0");
    expect(controlFixes).toContain("flex: 0 0 1rem");
  });

  it("protects Today selection rows from checkbox-driven text squeezing", () => {
    expect(todaySource).toContain('className="mt-1 h-4 w-4 shrink-0"');
    expect(todaySource).toContain('className="min-w-0 flex-1"');
    expect(todaySource).toContain('className="break-words font-semibold text-slate-950 hover:text-orange-700"');
  });
});
