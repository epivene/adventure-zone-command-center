import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const component = fs.readFileSync(path.resolve(__dirname, "research-sources-attention.tsx"), "utf8");
const needsAttention = fs.readFileSync(path.resolve(__dirname, "needs-attention.tsx"), "utf8");

describe("Today research source reminders", () => {
  it("surfaces never-scouted and elapsed-window sources without auto-scouting", () => {
    expect(component).toContain("Never scouted");
    expect(component).toContain("Ready for next window");
    expect(component).toContain("New prospects waiting");
    expect(component).toContain('apiGet<{ sources: SavedResearchSource[] }>("/research-sources")');
    expect(component).not.toContain("/scout\"");
    expect(component).not.toContain("apiPost");
  });

  it("lives under Today Needs Attention and links to the reusable source library", () => {
    expect(needsAttention).toContain("ResearchSourcesAttention");
    expect(component).toContain('href="/research-sources"');
  });
});
