import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = fileURLToPath(new URL("./mobile-compact.css", import.meta.url));
const mainPath = fileURLToPath(new URL("./main.tsx", import.meta.url));
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
