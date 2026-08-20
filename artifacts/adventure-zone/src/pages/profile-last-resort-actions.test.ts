import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const eventProfilePage = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const primaryActions = readFileSync("src/components/profiles/profile-primary-actions.tsx", "utf8");
const detailSheet = readFileSync("src/components/profiles/profile-detail-sheet.tsx", "utf8");
const actionsMenu = readFileSync("src/components/profiles/profile-actions-menu.tsx", "utf8");

describe("profile-level Last Resort actions", () => {
  it("offers Last Resort from the full profile primary actions", () => {
    expect(primaryActions).toContain("Mark Last Resort");
    expect(primaryActions).toContain("Remove Last Resort");
    expect(eventProfilePage).toContain("<LastResortControl");
    expect(eventProfilePage).toContain("setLastResortAction");
  });

  it("offers Last Resort from the side-profile Actions menu", () => {
    expect(actionsMenu).toContain("Mark Last Resort");
    expect(actionsMenu).toContain("Remove Last Resort");
    expect(detailSheet).toContain("<LastResortControl");
    expect(detailSheet).toContain("setLastResortAction");
  });
});
