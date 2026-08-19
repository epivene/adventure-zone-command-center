import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/profile-research.ts", "utf8");

describe("profile research source scout route", () => {
  it("accepts a bounded source/date request on an existing research run", () => {
    expect(source).toContain('/event-profiles/:id/research/:runId/scout-source');
    expect(source).toContain("sourceUrl");
    expect(source).toContain("startDate");
    expect(source).toContain("endDate");
    expect(source).toContain("ProfileResearchSourceScoutService");
  });

  it("maps missing/not-ready parent runs without creating prospects", () => {
    expect(source).toContain("PROFILE_RESEARCH_RUN_NOT_FOUND");
    expect(source).toContain("PROFILE_RESEARCH_RUN_NOT_READY");
    expect(source).not.toContain("createBooking");
  });
});
