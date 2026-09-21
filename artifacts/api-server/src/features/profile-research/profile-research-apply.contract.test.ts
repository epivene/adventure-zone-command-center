import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apply = readFileSync("src/features/profile-research/profile-research-apply.ts", "utf8");
const routes = readFileSync("src/routes/profile-research.ts", "utf8");

describe("profile research apply safety contract", () => {
  it("re-reads live values and returns stale suggestions instead of overwriting", () => {
    expect(apply).toContain("suggestion.currentValue");
    expect(apply).toContain('return "stale" as const');
    expect(apply).toContain("result.stale.push(id)");
  });

  it("routes researched dates through facts rather than booking fields", () => {
    expect(apply).toContain('suggestion.targetKind === "event_date_fact"');
    expect(apply).toContain("EventDateRepository");
    expect(apply).toContain("supersedeActiveFact");
    expect(apply).not.toContain('"status", "probability"');
  });

  it("validates website, email, phone, state, and category before writing", () => {
    expect(apply).toContain("z.url()");
    expect(apply).toContain("z.email()");
    expect(apply).toContain("normalizeNorthAmericanPhone");
    expect(apply).toContain("two-letter state/region");
    expect(apply).toContain("placeTypes.has");
    expect(apply).toContain("Researched event dates must be stored as date facts");
  });

  it("bulk applies only high-confidence non-conflicting pending suggestions", () => {
    expect(apply).toContain('suggestion.confidence === "high" && !suggestion.conflict');
    expect(apply).toContain('suggestion.reviewStatus === "pending"');
  });

  it("exposes selected-only and high-confidence apply as explicit POST actions", () => {
    expect(routes).toContain('/research/:runId/apply"');
    expect(routes).toContain('/research/:runId/apply-high-confidence"');
    expect(routes).toContain("suggestionIds");
  });
});
