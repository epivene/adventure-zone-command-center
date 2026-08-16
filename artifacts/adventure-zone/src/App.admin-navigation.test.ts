import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const actMigrationSource = readFileSync("src/pages/ActMigrationPage.tsx", "utf8");

describe("admin sidebar route contracts", () => {
  it("routes the Profiles sidebar URL to the profiles page", () => {
    expect(appSource).toContain('<Route path="/profiles" component={OrganizationsPage} />');
  });

  it("routes profile cards to the existing profile detail page", () => {
    expect(appSource).toContain('<Route path="/profiles/:profileId" component={EventProfilePage} />');
  });

  it("routes the nested Act import sidebar URL to the import page", () => {
    expect(appSource).toContain('<Route path="/settings/act-migration" component={ActMigrationPage} />');
  });

  it("routes the archive recovery workspace and links to it from Act migration", () => {
    expect(appSource).toContain('<Route path="/settings/act-recovery" component={ActRecoveryPage} />');
    expect(actMigrationSource).toContain('href="/settings/act-recovery"');
    expect(actMigrationSource).toContain("Recover archived ACT data");
  });

  it("keeps the legacy direct URLs available too", () => {
    expect(appSource).toContain('<Route path="/organizations" component={OrganizationsPage} />');
    expect(appSource).toContain('<Route path="/act-migration" component={ActMigrationPage} />');
  });
});