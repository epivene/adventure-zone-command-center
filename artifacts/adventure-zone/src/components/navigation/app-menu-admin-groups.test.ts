import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("Admin Tools menu organization", () => {
  it("groups admin tools into four compact sections", () => {
    for (const label of ["Data & Imports", "Business Setup", "Connections", "System"]) {
      expect(source).toContain(`label: "${label}"`);
    }
  });

  it("keeps ACT recovery out of the everyday Admin Tools menu", () => {
    expect(source).not.toContain('{ href: "/settings/act-recovery", label: "ACT recovery" }');
  });

  it("keeps appearance separate from the admin tool groups", () => {
    expect(source).toContain("<AppearanceChoices appearance={appearance} onChange={chooseAppearance} />");
  });
});
