import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = path.resolve(__dirname, "mobile-compact.css");
const mainPath = path.resolve(__dirname, "main.tsx");
const css = readFileSync(cssPath, "utf8");
const main = readFileSync(mainPath, "utf8");

describe("mobile compact layout", () => {
  it("loads the compact mobile stylesheet app-wide", () => {
    expect(main).toContain("import './mobile-compact.css';");
  });

  it("uses a 90 percent root scale only on small phone widths", () => {
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?html\s*\{[\s\S]*?font-size:\s*90%;/);
  });

  it("keeps touch controls at least 44px tall on small phones", () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?button[\s\S]*?min-height:\s*44px;/);
  });
});
