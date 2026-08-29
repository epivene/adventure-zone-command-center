import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const menu = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const switcher = readFileSync("src/components/navigation/workspace-switcher.tsx", "utf8");
const main = readFileSync("src/main.tsx", "utf8");

describe("appearance navigation", () => {
  it("offers the design system Light and Dark appearances in the More menu", () => {
    expect(menu).toContain('label: "Light"');
    expect(menu).toContain('label: "Dark"');
    expect(menu).toContain("saveAppearance(value)");
  });

  it("initializes the saved per-device appearance before rendering", () => {
    expect(main).toContain("initializeAppearance();");
    expect(main).not.toContain("./appearance-themes.css");
  });

  it("shows the existing bounce-house site mark beside Adventure Zone", () => {
    expect(switcher).toContain('src="/favicon.svg"');
    expect(switcher).not.toContain("Tent");
  });
});
