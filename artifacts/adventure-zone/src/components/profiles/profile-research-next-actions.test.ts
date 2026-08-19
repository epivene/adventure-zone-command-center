import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const panel = fs.readFileSync(path.resolve(__dirname, "profile-research-panel.tsx"), "utf8");

describe("profile research next actions", () => {
  it("puts source actions beside completed research instead of hiding them below", () => {
    expect(panel).toContain("Next actions");
    expect(panel).toContain("Scout source");
    expect(panel).toContain("Save source");
    expect(panel).toContain("Open source");
    expect(panel).toContain("/research-sources?");
  });
});
