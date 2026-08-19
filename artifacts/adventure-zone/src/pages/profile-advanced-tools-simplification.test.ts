import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = fs.readFileSync(path.resolve(__dirname, "EventProfilePage.tsx"), "utf8");
const actions = fs.readFileSync(path.resolve(__dirname, "../components/profiles/profile-primary-actions.tsx"), "utf8");

describe("profile action hierarchy", () => {
  it("keeps primary profile actions on the normal profile surface", () => {
    expect(actions).toContain("Call");
    expect(actions).toContain("Log call");
    expect(actions).toContain("Edit profile");
    expect(actions).toContain("Add Event / Lead");
    expect(page).toContain("<ProfilePrimaryActions");
    expect(page).toContain("assistedCallingEnabled={data.assistedCallingEnabled === true}");
  });

  it("suppresses the duplicate workspace profile header inside More profile tools", () => {
    expect(page).toContain("More profile tools");
    expect(page).toContain("[&>div>header:first-child]:hidden");
    expect(page).not.toContain("Organization relationships, locations, calling tools, family notes, and the original detailed workspace.");
  });
});
