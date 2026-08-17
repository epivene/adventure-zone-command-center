import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sheetSource = readFileSync("src/components/profiles/profile-detail-sheet.tsx", "utf8");
const actionsSource = readFileSync("src/components/profiles/profile-actions-menu.tsx", "utf8");
const profilesSource = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");

describe("profile slide-in workspace", () => {
  it("shows the profile identity and keeps Overview Notes Events with grouped Actions", () => {
    expect(sheetSource).toContain("data?.place?.name");
    expect(sheetSource).toContain('["overview", "notes", "events"]');
    expect(sheetSource).toContain("ProfileActionsMenu");
    for (const label of ["Add", "Edit", "Organize", "More"]) expect(actionsSource).toContain(`>${label} `);
  });

  it("keeps raw history available below Notes with lightweight filters", () => {
    expect(sheetSource).toContain("History & imported changes");
    for (const filter of ["All", "Calls", "Notes", "Follow-ups", "ACT", "System"]) expect(sheetSource).toContain(`>${filter}<`);
  });

  it("opens from the Profiles list while preserving full profile routes", () => {
    expect(profilesSource).toContain("ProfileDetailSheet");
    expect(profilesSource).toContain("handleProfileLink");
    expect(sheetSource).toContain("fullPageHref");
  });
});
