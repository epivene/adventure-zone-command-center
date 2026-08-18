import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");

describe("Profiles page Event Families placement", () => {
  it("renders Event Families before the normal profile list", () => {
    const eventFamilies = page.indexOf("Event Families");
    const profileList = page.indexOf("<OrganizationList");

    expect(eventFamilies).toBeGreaterThan(-1);
    expect(profileList).toBeGreaterThan(-1);
    expect(eventFamilies).toBeLessThan(profileList);
  });
});
