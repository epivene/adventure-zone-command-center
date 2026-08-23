import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("Admin Tools menu organization", () => {
  it("groups admin tools into four compact sections", () => {
    for (const label of ["Data & Imports", "Business Setup", "Connections", "System"]) {
      expect(source).toContain(`label: "${label}"`);
    }
  });

  it("keeps ACT recovery reachable from Data & Imports", () => {
    const dataImportsStart = source.indexOf('label: "Data & Imports"');
    const actImport = source.indexOf('{ href: "/settings/act-migration", label: "ACT! import" }', dataImportsStart);
    const actRecovery = source.indexOf('{ href: "/settings/act-recovery", label: "ACT Recovery" }', dataImportsStart);
    const attendanceHistory = source.indexOf('{ href: "/imports/attendance-history", label: "Attendance history" }', dataImportsStart);

    expect(dataImportsStart).toBeGreaterThan(-1);
    expect(actImport).toBeGreaterThan(dataImportsStart);
    expect(actRecovery).toBeGreaterThan(actImport);
    expect(attendanceHistory).toBeGreaterThan(actRecovery);
  });

  it("keeps appearance separate from the admin tool groups", () => {
    expect(source).toContain("<AppearanceChoices appearance={appearance} onChange={chooseAppearance} />");
  });
});
