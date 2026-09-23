import { describe, expect, it } from "vitest";

import type { PackageIntelligenceSettingsRecord } from "./package-intelligence-settings";
import { buildCurrentOfferCatalog } from "./current-offer-catalog";

function record(
  code: string,
  name: string,
  basePriceCents: number,
  baseAttractionCount: number,
  footprint: string,
): PackageIntelligenceSettingsRecord {
  return {
    id: crypto.randomUUID(),
    code,
    name,
    basePriceCents,
    baseAttractionCount,
    normalCapacity: 1,
    temporaryUnavailableQuantity: 0,
    minimumAttractionCount: baseAttractionCount,
    maximumAttractionCount: baseAttractionCount,
    baseDurationMinDays: 1,
    baseDurationMaxDays: 4,
    customerDescription: `${name} description`,
    bookingTalkingPoints: `${name} talking points`,
    operationalRequirements: `Plan for about ${footprint} sq ft.`,
    setupNotes: "Standard setup.",
    knowledgeReviewNote: null,
    active: true,
  };
}

describe("current offer catalog", () => {
  it("keeps packages current and Foam Party separate", () => {
    const catalog = buildCurrentOfferCatalog([
      record("adventure_zone", "Adventure Zone", 900000, 10, "10,000–15,000"),
      record("weekend_warriors", "Warrior's Playground", 800000, 5, "7,000–10,000"),
      record("pirates_rebellion", "Pirate's Rebellion", 800000, 3, "5,000–7,000"),
      record("mini_zone", "Mini Zone", 500000, 5, "3,000–5,000"),
    ]);

    expect(catalog.packages.mini_zone.priceCents).toBe(500000);
    expect(catalog.packages.pirates_rebellion.marketingFootprint).toBe("5,000–7,000 sq ft");
    expect(catalog.addOns.foamParty).toEqual({
      code: "foam_party",
      name: "Foam Party Add-On",
      priceCents: 350000,
      availability: "add_on_only",
    });
    expect("foam_party" in catalog.packages).toBe(false);
  });

  it("rejects an incomplete approved package source", () => {
    expect(() => buildCurrentOfferCatalog([
      record("adventure_zone", "Adventure Zone", 900000, 10, "10,000–15,000"),
    ])).toThrow("PACKAGE_REQUIRED:weekend_warriors");
  });
});
