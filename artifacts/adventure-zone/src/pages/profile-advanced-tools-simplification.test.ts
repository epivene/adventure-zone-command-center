import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = fs.readFileSync(path.resolve(__dirname, "EventProfilePage.tsx"), "utf8");
const actions = fs.readFileSync(path.resolve(__dirname, "../components/profiles/profile-primary-actions.tsx"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../components/profiles/festival-profile-workspace.tsx"), "utf8");

describe("profile action hierarchy", () => {
  it("keeps existing primary actions available while the detailed workspace remains connected", () => {
    expect(actions).toContain("Call");
    expect(actions).toContain("Log call");
    expect(actions).toContain("Edit profile");
    expect(actions).toContain("Add Event / Lead");
    expect(page).toContain("onFollowUp={() => setFollowUpOpen(true)}");
    expect(page).toContain("assistedCallingEnabled={data.assistedCallingEnabled === true}");
  });

  it("keeps the detailed workspace inside the single shared profile tools section", () => {
    expect(page).not.toContain("More profile tools");
    expect(page).toContain("<EventProfileWorkspace");
    expect(workspace).toContain("Activity, records &amp; profile tools");
    expect(page).not.toContain("Organization relationships, locations, calling tools, family notes, and the original detailed workspace.");
  });
});
