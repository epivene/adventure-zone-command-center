import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const menuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("admin navigation route contracts", () => {
  it("lands signed-in administrators on the Command Panel", () => {
    expect(appSource).toContain('if (isSignedIn) return <Redirect to="/command" />');
    expect(appSource).toContain('if (result.ok) setLocation("/command")');
    expect(appSource).toContain('return isSignedIn ? <Redirect to="/command" /> : <Landing />');
    expect(appSource).toContain('<Route path="/command" component={AdminCommandPanelPage} />');
  });

  it("removes Marketing while preserving canonical Profiles routes", () => {
    expect(appSource).not.toContain("MarketingHomePage");
    expect(appSource).toContain('<Route path="/profiles" component={OrganizationsPage} />');
    expect(appSource).toContain('<Route path="/profiles/:profileId" component={EventProfilePage} />');
  });

  it("makes Schedule canonical while preserving calendar and route aliases", () => {
    expect(appSource).toContain('<Route path="/schedule" component={SchedulePage} />');
    expect(appSource).toContain('<Route path="/calendar"><ScheduleRedirect /></Route>');
    expect(appSource).toContain('<Route path="/routes"><ScheduleRedirect view="map" /></Route>');
    expect(appSource).toContain('<Route path="/operations/legs" component={LegManagementPage} />');
  });

  it("keeps maintenance destinations inside compact Admin Tools groups", () => {
    expect(menuSource).toContain('label: "Data & Imports"');
    expect(menuSource).toContain('{ href: "/settings/paper-notes", label: "Paper notes" }');
    expect(menuSource).toContain('{ href: "/settings/call-scripts", label: "Call scripts" }');
    expect(menuSource).toContain('{ href: "/settings/packages-resources", label: "Packages & resources" }');
  });

  it("keeps Paper notes while removing ACT maintenance routes", () => {
    expect(appSource).not.toMatch(/ActMigrationPage|ActRecoveryPage|settings\/act-/);
    expect(appSource).toContain('<Route path="/settings/paper-notes" component={PaperNotesInboxPage} />');
    expect(appSource).toContain('<Route path="/settings/paper-notes/:batchId">');
  });

  it("keeps old profile URLs only as compatibility redirects", () => {
    expect(appSource).toContain('<Route path="/organizations"><ProfilesRedirect /></Route>');
    expect(appSource).toContain('<Route path="/event-profiles/:id">');
    expect(appSource).toContain('canonicalProfilePath(params.id)');
  });

  it("does not alter Office Coordinator or Leg Manager route shells", () => {
    expect(appSource).toContain('<Route path={OFFICE_PROTECTED_PATH}><OfficeAuthProvider><OfficeProtectedApp /></OfficeAuthProvider></Route>');
    expect(appSource).toContain('<Route path={MANAGER_PROTECTED_PATH}><ManagerAuthProvider><ManagerProtectedApp /></ManagerAuthProvider></Route>');
  });
});
