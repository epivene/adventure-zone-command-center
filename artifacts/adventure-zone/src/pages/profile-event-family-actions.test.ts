import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const organizationsPage = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");
const actionsMenu = readFileSync("src/components/profiles/profile-actions-menu.tsx", "utf8");
const dialog = readFileSync("src/components/event-families/manual-event-family-dialog.tsx", "utf8");

describe("manual event family actions", () => {
  it("offers a Create event family action from Profiles", () => {
    expect(organizationsPage).toContain("+ Event Family");
    expect(organizationsPage).toContain("ManualEventFamilyDialog");
  });

  it("offers Add to Event Family from a profile Actions menu", () => {
    expect(actionsMenu).toContain("Add to Event Family");
    expect(actionsMenu).toContain("ManualEventFamilyDialog");
  });

  it("supports adding to an existing family or creating a new family", () => {
    expect(dialog).toContain("Add to existing family");
    expect(dialog).toContain("Create new family");
    expect(dialog).toContain("/event-families");
    expect(dialog).toContain("/members");
  });
});
