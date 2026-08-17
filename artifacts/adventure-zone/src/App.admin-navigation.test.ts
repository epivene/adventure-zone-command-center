import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const actMigrationSource = readFileSync("src/pages/ActMigrationPage.tsx", "utf8");

describe("admin navigation route contracts", () => {
  it("routes the Profiles URL to the profiles page", () => {
    expect(appSource).toContain('<Route path="/profiles" component={OrganizationsPage} />');
  });

  it("routes profile cards to the existing profile detail page", () => {
    expect(appSource).toContain('<Route path="/profiles/:profileId" component={EventProfilePage} />');
  });

  it("adds the combined Schedule route while keeping legacy calendar and routes URLs", () => {
    expect(appSource).toContain('<Route path="/schedule" component={SchedulePage} />');
    expect(appSource).toContain('<Route path="/calendar" component={CalendarPage} />');
    expect(appSource).toContain('<Route path="/routes" component={RoutesPage} />');
  });

  it("routes the nested Act import URL to the import page", () => {
    expect(appSource).toContain('<Route path="/settings/act-migration" component={ActMigrationPage} />');
  });

  it("routes archive recovery and links to it from Act migration", () => {
    expect(appSource).toContain('<Route path="/settings/act-recovery" component={ActRecoveryPage} />');
    expect(actMigrationSource).toContain('href="/settings/act-recovery"');
    expect(actMigrationSource).toContain("Recover archived ACT data");
  });

  it("keeps legacy direct URLs available", () => {
    expect(appSource).toContain('<Route path="/organizations" component={OrganizationsPage} />');
    expect(appSource).toContain('<Route path="/act-migration" component={ActMigrationPage} />');
  });
});
