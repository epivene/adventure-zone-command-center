import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const primaryActions = readFileSync("src/components/profiles/profile-primary-actions.tsx", "utf8");
const actionsMenu = readFileSync("src/components/profiles/profile-actions-menu.tsx", "utf8");
const lastResortAction = readFileSync("src/components/profiles/profile-last-resort-action.tsx", "utf8");

describe("profile-level Last Resort actions", () => {
  it("offers Last Resort from the full profile primary actions", () => {
    expect(primaryActions).toContain("ProfileLastResortButton");
    expect(lastResortAction).toContain("Mark Last Resort");
    expect(lastResortAction).toContain("Remove Last Resort");
  });

  it("offers Last Resort from the side-profile Actions menu", () => {
    expect(actionsMenu).toContain("ProfileLastResortDialog");
    expect(actionsMenu).toContain("Mark Last Resort");
    expect(actionsMenu).toContain("Remove Last Resort");
    expect(lastResortAction).toContain("setLastResortAction");
  });
});
