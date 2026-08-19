import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "profile-research-panel.tsx"), "utf8");

describe("profile research site discovery UI", () => {
  it("keeps non-writable researched information visible as key findings", () => {
    expect(source).toContain("Key findings");
    expect(source).toContain("Useful researched information that may not belong in a single editable profile field");
    expect(source).toContain("findings.length");
  });

  it("shows related event opportunities separately in deep research", () => {
    expect(source).toContain("Other event opportunities found");
    expect(source).toContain("Already in Command Center");
    expect(source).toContain("Possible match");
    expect(source).toContain("New prospect");
    expect(source).toContain("Open source");
  });

  it("explains that deep research scouts calendars and directories", () => {
    expect(source).toContain("scouts useful event calendars/directories");
    expect(source).toContain("compares discoveries with Command Center");
  });
});
