import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/MarketingHomePage.tsx", "utf8");

describe("Marketing page copy density", () => {
  it("avoids long explanatory labels and duplicate CRM/archive copy", () => {
    expect(source).not.toContain("Nothing is copied into a second CRM or Gmail archive.");
    expect(source).not.toContain("Mass marketing emails");
    expect(source).not.toContain("Profiles & audiences");
    expect(source).not.toContain("Opportunity research");
    expect(source).not.toContain("Marketing setup & shared data");
  });

  it("uses shorter scan-friendly labels", () => {
    expect(source).toContain("Email campaigns");
    expect(source).toContain(">Profiles<");
    expect(source).toContain(">Research<");
    expect(source).toContain(">Marketing setup<");
  });
});
