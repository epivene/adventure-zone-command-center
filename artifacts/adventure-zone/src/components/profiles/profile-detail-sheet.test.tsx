import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sheetSource = readFileSync("src/components/profiles/profile-detail-sheet.tsx", "utf8");
const actionsSource = readFileSync("src/components/profiles/profile-actions-menu.tsx", "utf8");
const profilesSource = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");

describe("profile slide-in workspace", () => {
  it("keeps Overview History Events and grouped Actions", () => {
    expect(sheetSource).toContain('["overview", "history", "events"]');
    expect(sheetSource).toContain("ProfileActionsMenu");
    for (const label of ["Add", "Edit", "Organize", "More"]) expect(actionsSource).toContain(`>${label} `);
  });

  it("opens from the Profiles list while preserving full profile routes", () => {
    expect(profilesSource).toContain("ProfileDetailSheet");
    expect(profilesSource).toContain("handleProfileLink");
    expect(sheetSource).toContain("fullPageHref");
  });
});
