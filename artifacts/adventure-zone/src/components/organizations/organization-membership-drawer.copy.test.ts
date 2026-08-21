import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const drawer = fs.readFileSync(path.resolve(__dirname, "organization-membership-drawer.tsx"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../event-profiles/event-profile-workspace.tsx"), "utf8");

describe("profile relationship wording", () => {
  it("does not offer creating a new profile from inside another profile", () => {
    expect(drawer).not.toContain("Create new");
    expect(drawer).not.toContain("/event-profiles/new?organizationId=");
  });

  it("labels this as linking existing profiles rather than adding locations", () => {
    expect(drawer).toContain("Link existing profile");
    expect(drawer).toContain("Find an existing profile to link");
    expect(workspace).toContain("Related profiles");
    expect(workspace).toContain("Link existing profile");
  });
});
