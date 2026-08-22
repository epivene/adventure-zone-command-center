import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("Google Workspace owner navigation", () => {
  it("routes Google Workspace before the generic settings route", () => {
    const app = source("src/App.tsx");
    const googleAt = app.indexOf(
      '<Route path="/settings/google-workspace" component={SettingsGoogleWorkspacePage} />',
    );
    const genericSettingsAt = app.indexOf(
      '<Route path="/settings" component={SettingsStub} />',
    );

    expect(googleAt).toBeGreaterThan(-1);
    expect(genericSettingsAt).toBeGreaterThan(googleAt);
  });

  it("shows Google Workspace only in owner navigation", () => {
    const app = source("src/App.tsx");
    const ownerMenu = source("src/components/navigation/app-menu.tsx");
    const officeShell = source("src/components/office/office-shell.tsx");
    const managerShell = source("src/components/manager/manager-shell.tsx");

    expect(app).toContain(
      '["Google Workspace", "/settings/google-workspace", "Connect the read-only company Gmail, Drive, and Calendar scope."]',
    );
    expect(app).not.toContain("as that implementation lands");
    expect(ownerMenu).toContain(
      '{ href: "/settings/google-workspace", label: "Google Workspace" }',
    );
    expect(officeShell).not.toContain("google-workspace");
    expect(officeShell).not.toContain("Google Workspace");
    expect(managerShell).not.toContain("google-workspace");
    expect(managerShell).not.toContain("Google Workspace");
  });
});
