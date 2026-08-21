import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const drawer = fs.readFileSync(path.resolve(__dirname, "organization-membership-drawer.tsx"), "utf8");

describe("profile relationship wording", () => {
  it("does not offer creating a new profile from inside another profile", () => {
    expect(drawer).not.toContain("Create new");
    expect(drawer).not.toContain("/event-profiles/new?organizationId=");
    expect(drawer).not.toContain("useLocation");
  });

  it("makes clear that this links an existing profile rather than adding a location", () => {
    expect(drawer).toContain("Link existing profile");
    expect(drawer).toContain("Find an existing profile to link");
    expect(drawer).toContain("use Locations on the main profile");
    expect(drawer).toContain("Search existing profiles");
  });
});
