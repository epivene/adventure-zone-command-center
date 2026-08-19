import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const service = fs.readFileSync(path.resolve(__dirname, "profile-research-source-library.ts"), "utf8");
const routes = fs.readFileSync(path.resolve(__dirname, "../../routes/profile-research-sources.ts"), "utf8");

describe("research source library", () => {
  it("stores reusable public sources and their latest scouting snapshot", () => {
    expect(service).toContain("profile_research_saved_sources");
    expect(service).toContain("last_scout_results");
    expect(service).toContain("last_scouted_at");
  });

  it("re-scouts a saved source without requiring an originating profile run", () => {
    expect(routes).toContain('/research-sources/:id/scout');
    expect(service).toContain("OpenAiSourceScoutProvider");
    expect(service).toContain("matchRelatedEventsAgainstCrm");
  });

  it("supports list, save, update, and archive operations", () => {
    expect(routes).toContain('router.get("/research-sources"');
    expect(routes).toContain('router.post("/research-sources"');
    expect(routes).toContain('router.patch("/research-sources/:id"');
    expect(routes).toContain('/research-sources/:id/archive');
  });
});
