import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const menuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const actMigrationSource = readFileSync("src/pages/ActMigrationPage.tsx", "utf8");

describe("admin navigation route contracts", () => {
  it("lands signed-in administrators on the Command Panel", () => {
    expect(appSource).toContain('if (isSignedIn) return <Redirect to="/command" />');
    expect(appSource).toContain('if (result.ok) setLocation("/command")');
    expect(appSource).toContain('return isSignedIn ? <Redirect to="/command" /> : <Landing />');
    expect(appSource).toContain('<Route path="/command" component={AdminCommandPanelPage} />');
  });

  it("mounts the dedicated Marketing workspace without moving shared CRM routes", () => {
    expect(appSource).toContain('<Route path="/marketing" component={MarketingHomePage} />');
    expect(appSource).toContain('<Route path="/profiles" component={OrganizationsPage} />');
    expect(appSource).toContain('<Route path="/profiles/:profileId" component={EventProfilePage} />');
  });

  it("keeps Schedule, Calendar, and Routes on their existing URLs", () => {
    expect(appSource).toContain('<Route path="/schedule" component={SchedulePage} />');
    expect(appSource).toContain('<Route path="/calendar" component={CalendarPage} />');
    expect(appSource).toContain('<Route path="/routes" component={RoutesPage} />');
  });

  it("keeps maintenance destinations inside the compact Admin Tools menu", () => {
    expect(menuSource).toContain('label: "Admin Tools"');
    expect(menuSource).toContain('{ href: "/settings/paper-notes", label: "Paper notes" }');
    expect(menuSource).toContain('{ href: "/settings/act-migration", label: "Act! import" }');
    expect(menuSource).toContain('{ href: "/settings/act-recovery", label: "ACT recovery" }');
    expect(menuSource).toContain('{ href: "/settings/call-scripts", label: "Call scripts" }');
    expect(menuSource).toContain('{ href: "/settings/packages-resources", label: "Packages & resources" }');
  });

  it("routes Paper notes and ACT maintenance exactly as before", () => {
    expect(appSource).toContain('<Route path="/settings/paper-notes" component={PaperNotesInboxPage} />');
    expect(appSource).toContain('<Route path="/settings/paper-notes/:batchId">');
    expect(appSource).toContain('<Route path="/settings/act-migration" component={ActMigrationPage} />');
    expect(appSource).toContain('<Route path="/settings/act-recovery" component={ActRecoveryPage} />');
    expect(actMigrationSource).toContain('href="/settings/act-recovery"');
    expect(actMigrationSource).toContain("Recover archived ACT data");
  });

  it("keeps legacy direct URLs available", () => {
    expect(appSource).toContain('<Route path="/organizations" component={OrganizationsPage} />');
    expect(appSource).toContain('<Route path="/act-migration" component={ActMigrationPage} />');
  });

  it("does not alter Office Coordinator or Leg Manager route shells", () => {
    expect(appSource).toContain('<Route path={OFFICE_PROTECTED_PATH}><OfficeAuthProvider><OfficeProtectedApp /></OfficeAuthProvider></Route>');
    expect(appSource).toContain('<Route path={MANAGER_PROTECTED_PATH}><ManagerAuthProvider><ManagerProtectedApp /></ManagerAuthProvider></Route>');
  });
});
