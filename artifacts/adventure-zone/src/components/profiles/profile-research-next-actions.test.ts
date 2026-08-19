import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const panel = fs.readFileSync(path.resolve(__dirname, "profile-research-panel.tsx"), "utf8");
const actions = fs.readFileSync(path.resolve(__dirname, "profile-research-next-actions.tsx"), "utf8");

describe("profile research next actions", () => {
  it("puts source actions beside completed research instead of hiding them below", () => {
    expect(panel).toContain("ProfileResearchNextActions");
    expect(panel).toContain("onScout={openScout}");
    expect(actions).toContain("Next actions");
    expect(actions).toContain("Scout source");
    expect(actions).toContain("Save source");
    expect(actions).toContain("Open source");
    expect(actions).toContain("/research-sources?");
  });
});
