import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const panel = fs.readFileSync(path.resolve(__dirname, "profile-research-panel.tsx"), "utf8");
const page = fs.readFileSync(path.resolve(__dirname, "../../pages/EventProfilePage.tsx"), "utf8");
const brief = fs.readFileSync(path.resolve(__dirname, "../today/contact-brief-card.tsx"), "utf8");

describe("profile research release 1 finish", () => {
  it("runs Quick or Deep immediately when that research action is tapped", () => {
    expect(panel).toContain("startResearch(value)");
    expect(panel).toContain("Research Quick");
    expect(panel).toContain("Research Deep");
    expect(panel).not.toContain("onClick={() => setMode(value)}");
  });

  it("surfaces meaningful profile gaps without auto-starting web research", () => {
    expect(page).toContain("profileResearchGaps");
    expect(page).toContain("Research profile ·");
    expect(page).toContain('params.get("research") === "1"');
    expect(page).not.toContain("startResearch(");
  });

  it("lets the booking contact brief hand the user into research when profile info is thin", () => {
    expect(brief).toContain("Missing profile info");
    expect(brief).toContain("Research profile");
    expect(brief).toContain("?research=1");
  });
});
