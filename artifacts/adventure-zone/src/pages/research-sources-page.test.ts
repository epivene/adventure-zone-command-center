import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = fs.readFileSync(path.resolve(__dirname, "ResearchSourcesPage.tsx"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const menu = fs.readFileSync(path.resolve(__dirname, "../components/navigation/app-menu.tsx"), "utf8");
const startup = fs.readFileSync(path.resolve(__dirname, "../../../api-server/src/db/profile-research-startup-migration.ts"), "utf8");

describe("Research Sources library", () => {
  it("is reachable from the app and admin menu", () => {
    expect(app).toContain('path="/research-sources"');
    expect(menu).toContain('href: "/research-sources"');
  });

  it("supports reusable scouting without a profile research run", () => {
    expect(page).toContain('apiPost<{ source: SavedSource }>(`/research-sources/${source.id}/scout`');
    expect(page).toContain("Scout again");
    expect(page).toContain("Latest scout results");
  });

  it("ships its persistence table through startup schema recovery", () => {
    expect(startup).toContain("profile_research_saved_sources");
    expect(startup).toContain("last_scout_results");
  });
});
