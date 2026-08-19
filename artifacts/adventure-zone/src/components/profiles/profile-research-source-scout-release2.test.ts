import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/profile-research-panel.tsx", "utf8");

describe("profile research source scout release 2", () => {
  it("lets the user deliberately scout a cited source over a date window", () => {
    expect(source).toContain("Scout this source");
    expect(source).toContain("Scout from");
    expect(source).toContain("Scout through");
    expect(source).toContain("scout-source");
  });

  it("renders persisted scout results with CRM comparison labels", () => {
    expect(source).toContain("Source Scout results");
    expect(source).toContain("sourceScouts");
    expect(source).toContain("Already in Command Center");
    expect(source).toContain("Possible match");
    expect(source).toContain("New prospect");
  });

  it("does not create CRM leads from Source Scout", () => {
    expect(source).not.toContain("Create selected leads");
    expect(source).not.toContain("Add selected prospects");
  });
});
