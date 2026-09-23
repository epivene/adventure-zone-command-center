import { describe, expect, it } from "vitest";

import { REVIEWED_PACKAGE_DEFAULTS } from "./package-defaults";
import { packageTemplateInputSchema } from "./package-input";

describe("reviewed package defaults", () => {
  it("uses the reviewed 2026 starting prices and durations", () => {
    expect(REVIEWED_PACKAGE_DEFAULTS.adventure_zone).toMatchObject({
      basePriceCents: 900000,
      minimumAttractionCount: 10,
      maximumAttractionCount: 12,
      baseDurationMinDays: 1,
      baseDurationMaxDays: 4,
    });
    expect(REVIEWED_PACKAGE_DEFAULTS.pirates_rebellion).toMatchObject({
      basePriceCents: 800000,
      baseAttractionCount: 3,
      baseDurationMinDays: 1,
      baseDurationMaxDays: 4,
    });
    expect(REVIEWED_PACKAGE_DEFAULTS.weekend_warriors).toMatchObject({
      basePriceCents: 800000,
      baseAttractionCount: 5,
      baseDurationMinDays: 1,
      baseDurationMaxDays: 4,
    });
    expect(REVIEWED_PACKAGE_DEFAULTS.mini_zone).toMatchObject({
      basePriceCents: 500000,
      baseAttractionCount: 5,
      baseDurationMinDays: 1,
      baseDurationMaxDays: 4,
    });
  });

  it("uses the approved 2026 marketing footprints", () => {
    expect(REVIEWED_PACKAGE_DEFAULTS.adventure_zone.operationalRequirements)
      .toContain("10,000–15,000 sq ft");
    expect(REVIEWED_PACKAGE_DEFAULTS.weekend_warriors.operationalRequirements)
      .toContain("7,000–10,000 sq ft");
    expect(REVIEWED_PACKAGE_DEFAULTS.pirates_rebellion.operationalRequirements)
      .toContain("5,000–7,000 sq ft");
    expect(REVIEWED_PACKAGE_DEFAULTS.mini_zone.operationalRequirements)
      .toContain("3,000–5,000 sq ft");
  });

  it("keeps the Mini Zone barrel disagreement out of approved operational requirements", () => {
    const mini = REVIEWED_PACKAGE_DEFAULTS.mini_zone;
    expect(mini.operationalRequirements).not.toMatch(/44 barrels|50 barrels/i);
    expect(mini.knowledgeReviewNote).toMatch(/44 vs 50/i);
  });

  it("accepts editable duration and review-note fields in package settings input", () => {
    const parsed = packageTemplateInputSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Mini Zone",
      basePriceCents: 500000,
      baseAttractionCount: 5,
      normalCapacity: 0,
      temporaryUnavailableQuantity: 0,
      minimumAttractionCount: 5,
      maximumAttractionCount: 5,
      baseDurationMinDays: 1,
      baseDurationMaxDays: 4,
      customerDescription: "Smaller event setup.",
      bookingTalkingPoints: "Use when space or budget is tighter.",
      operationalRequirements: "Confirm power and footprint.",
      setupNotes: "Normal setup window.",
      knowledgeReviewNote: "Water-barrel source conflict: 44 vs 50; confirm before quoting.",
      active: true,
    });
    expect(parsed.success).toBe(true);
  });
});
