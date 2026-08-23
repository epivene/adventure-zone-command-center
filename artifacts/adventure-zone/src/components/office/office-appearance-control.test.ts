import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/office/office-shell.tsx", "utf8");

describe("Office Coordinator appearance control", () => {
  it("uses the shared per-device appearance system", () => {
    expect(source).toContain("readAppearance");
    expect(source).toContain("saveAppearance");
    expect(source).toContain('label: "Light"');
    expect(source).toContain('label: "Warm Light"');
    expect(source).toContain('label: "Dark"');
  });

  it("keeps appearance accessible from the compact header without adding another bottom-nav tab", () => {
    expect(source).toContain('aria-label="Appearance"');
    expect(source).toContain("DropdownMenu");
    expect(source).toContain("grid-cols-6");
    expect(source).not.toContain("grid-cols-7");
  });
});
