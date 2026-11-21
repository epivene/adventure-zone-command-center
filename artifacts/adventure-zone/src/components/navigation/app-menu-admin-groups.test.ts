import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("Admin Tools menu organization", () => {
  it("groups admin tools into four compact sections", () => {
    for (const label of ["Data & Imports", "Business Setup", "Connections", "System"]) {
      expect(source).toContain(`label: "${label}"`);
    }
    expect(source).toContain('label="Administration"');
    expect(source).toContain("nestedGroups");
    expect(source).toContain("<DropdownMenuSub>");
    expect(source).toContain("<DropdownMenuSubContent");
  });

  it("removes ACT tools while retaining attendance imports", () => {
    expect(source).not.toMatch(/act-migration|act-recovery/);
    expect(source).toContain('href: "/imports/attendance-history"');
  });

  it("keeps appearance separate from the admin tool groups", () => {
    expect(source).toContain("<AppearanceChoices appearance={appearance} onChange={chooseAppearance} />");
  });
});
