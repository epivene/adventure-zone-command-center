import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = fs.readFileSync(path.resolve(__dirname, "EventProfilePage.tsx"), "utf8");
const simple = fs.readFileSync(path.resolve(__dirname, "../components/profiles/simple-full-profile.tsx"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../components/event-profiles/event-profile-workspace.tsx"), "utf8");

describe("profile action hierarchy", () => {
  it("keeps primary profile actions on the normal profile surface", () => {
    expect(simple).toContain("Call");
    expect(simple).toContain("Log call");
    expect(simple).toContain("Add Event / Lead");
    expect(page).toContain("assistedCallingEnabled={data.assistedCallingEnabled === true}");
  });

  it("suppresses the duplicate workspace profile header inside Advanced tools", () => {
    expect(workspace).toContain("embedded");
    expect(page).toContain("embedded");
    expect(page).toContain("More profile tools");
    expect(page).not.toContain("Organization relationships, locations, calling tools, family notes, and the original detailed workspace.");
  });
});
