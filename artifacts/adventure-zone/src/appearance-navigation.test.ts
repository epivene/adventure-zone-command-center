import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const menu = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const switcher = readFileSync("src/components/navigation/workspace-switcher.tsx", "utf8");
const main = readFileSync("src/main.tsx", "utf8");
const themeCss = readFileSync("src/appearance-themes.css", "utf8");

describe("appearance navigation", () => {
  it("offers Light, Warm Light, and Dark in the More menu", () => {
    expect(menu).toContain('label: "Light"');
    expect(menu).toContain('label: "Warm Light"');
    expect(menu).toContain('label: "Dark"');
    expect(menu).toContain("saveAppearance(value)");
  });

  it("initializes the saved per-device appearance before rendering", () => {
    expect(main).toContain("initializeAppearance();");
    expect(main).toContain("./appearance-themes.css");
  });

  it("provides real warm and dark palettes rather than a screen filter", () => {
    expect(themeCss).toContain("html.warm-light");
    expect(themeCss).toContain("html.dark");
    expect(themeCss).not.toContain("filter: sepia");
    expect(themeCss).not.toContain("filter: hue-rotate");
  });

  it("shows the existing bounce-house site mark beside Adventure Zone", () => {
    expect(switcher).toContain('src="/favicon.svg"');
    expect(switcher).not.toContain("Tent");
  });
});
