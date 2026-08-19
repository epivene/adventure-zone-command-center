import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const panel = readFileSync("src/components/profiles/profile-research-panel.tsx", "utf8");

describe("profile research review workflow", () => {
  it("adds research to the full profile without changing the compact detail cards", () => {
    expect(page).toContain("Research profile");
    expect(page).toContain("<ProfileResearchPanel");
    expect(page).toContain("researchOpen");
    expect(page.indexOf("Research profile")).toBeLessThan(page.indexOf("Advanced profile tools"));
  });

  it("supports Quick and Deep research and keeps all mutations user-triggered", () => {
    expect(panel).toContain('"quick", "deep"');
    expect(panel).toContain("Start research");
    expect(panel).toContain("Research again");
    expect(panel).toContain("Add selected");
    expect(panel).toContain("Add all high-confidence");
    expect(panel).toContain("Dismiss");
  });

  it("preselects only high-confidence non-conflicting suggestions", () => {
    expect(panel).toContain('suggestion.confidence === "high" && !suggestion.conflict');
    expect(panel).toContain("Changes existing value");
    expect(panel).toContain("Current:");
    expect(panel).toContain("Found:");
  });

  it("shows evidence links and explains that research does not write automatically", () => {
    expect(panel).toContain("Find public information, review the evidence, then choose what gets added.");
    expect(panel).toContain("Nothing changes until you approve it.");
    expect(panel).toContain('target="_blank"');
    expect(panel).toContain("source.title");
  });

  it("surfaces stale-value outcomes instead of hiding them", () => {
    expect(panel).toContain("need review because the profile changed");
    expect(panel).toContain("could not be validated");
  });
});
