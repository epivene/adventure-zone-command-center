import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const menu = readFileSync("src/components/manager/manager-menu.tsx", "utf8");
const shell = readFileSync("src/components/manager/manager-shell.tsx", "utf8");

describe("leg manager appearance", () => {
  it("offers the shared per-device appearance choices in the manager menu", () => {
    expect(menu).toContain('label: "Light"');
    expect(menu).toContain('label: "Warm Light"');
    expect(menu).toContain('label: "Dark"');
    expect(menu).toContain("readAppearance");
    expect(menu).toContain("saveAppearance");
  });

  it("uses theme-aware manager shell surfaces", () => {
    expect(shell).toContain("bg-background");
    expect(shell).toContain("border-border");
    expect(shell).toContain("bg-card/95");
  });
});
