import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("admin sidebar route contracts", () => {
  it("routes the Profiles sidebar URL to the profiles page", () => {
    expect(appSource).toContain('<Route path="/profiles" component={OrganizationsPage} />');
  });

  it("routes the nested Act import sidebar URL to the import page", () => {
    expect(appSource).toContain('<Route path="/settings/act-migration" component={ActMigrationPage} />');
  });

  it("keeps the legacy direct URLs available too", () => {
    expect(appSource).toContain('<Route path="/organizations" component={OrganizationsPage} />');
    expect(appSource).toContain('<Route path="/act-migration" component={ActMigrationPage} />');
  });
});
