import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const profileSheet = readFileSync("src/components/profiles/profile-detail-sheet.tsx", "utf8");
const profileList = readFileSync("src/components/organizations/organization-list.tsx", "utf8");
const workspacePage = readFileSync("src/pages/CallWorkspacePage.tsx", "utf8");
const workspaceFlowCss = readFileSync("src/call-workspace-flow.css", "utf8");
const guidedScripts = readFileSync("src/features/calls/guided-call-scripts.ts", "utf8");

describe("Adventure Zone call flow", () => {
  it("opens the guided workspace from profile phone entry points", () => {
    expect(profileSheet).toContain("/calls/new?${callQuery.toString()}");
    expect(profileSheet).not.toContain("href={phoneLink}");
    expect(profileList).toContain("/calls/new?organizationId=${encodeURIComponent(organization.id)}");
    expect(profileList).not.toContain("href={`tel:${organization.phone}`}");
  });

  it("puts the phone card first and keeps Assistant secondary", () => {
    expect(workspaceFlowCss).toContain('section[aria-labelledby="phone-actions-title"]');
    expect(workspaceFlowCss).toContain("order: 1");
    expect(workspaceFlowCss).toContain('section[aria-labelledby="guided-script-title"]');
    expect(workspaceFlowCss).toContain("order: 3");
    expect(workspacePage.indexOf("<CallWorkspace")).toBeLessThan(workspacePage.indexOf("<CallAssistantPanel"));
  });

  it("uses an Adventure Zone-specific, family-friendly carnival voice", () => {
    expect(guidedScripts).toContain("The Adventure Zone");
    expect(guidedScripts).toContain("traveling inflatable carnival");
    expect(guidedScripts).toContain("bounce houses");
    expect(guidedScripts).toContain("giant slides");
    expect(guidedScripts).toContain("obstacle courses");
    expect(guidedScripts).toContain("carnival games");
  });
});
