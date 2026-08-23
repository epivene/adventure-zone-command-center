import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/App.tsx", "utf8");

describe("legacy route consolidation", () => {
  it("keeps canonical destinations mounted as real pages", () => {
    expect(source).toContain('<Route path="/calls/workspace" component={CallWorkspacePage} />');
    expect(source).toContain('<Route path="/calls/log" component={MobileCallLogPage} />');
    expect(source).toContain('<Route path="/schedule" component={SchedulePage} />');
    expect(source).toContain('<Route path="/profiles" component={OrganizationsPage} />');
    expect(source).toContain('<Route path="/settings/act-migration" component={ActMigrationPage} />');
  });

  it("redirects legacy aliases instead of mounting their old pages", () => {
    for (const legacyPath of [
      "/calls/new",
      "/calls/mobile",
      "/quick-add",
      "/calendar",
      "/routes",
      "/organizations",
      "/event-profiles/:id",
      "/act-migration",
    ]) {
      expect(source).toContain(`path="${legacyPath}"`);
    }

    expect(source).not.toContain('<Route path="/calls/new" component={CallWorkspacePage} />');
    expect(source).not.toContain('<Route path="/calls/mobile" component={MobileCallLogPage} />');
    expect(source).not.toContain('<Route path="/quick-add" component={QuickAddPage} />');
    expect(source).not.toContain('<Route path="/calendar" component={CalendarPage} />');
    expect(source).not.toContain('<Route path="/routes" component={RoutesPage} />');
    expect(source).not.toContain('<Route path="/organizations" component={OrganizationsPage} />');
    expect(source).not.toContain('<Route path="/event-profiles/:id">{(params)=><EventProfilePage profileId={params.id}/>}</Route>');
    expect(source).not.toContain('<Route path="/act-migration" component={ActMigrationPage} />');
  });
});
