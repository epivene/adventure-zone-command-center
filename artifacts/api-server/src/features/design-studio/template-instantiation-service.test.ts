import { describe, expect, it } from "vitest";

import type { CurrentOfferCatalog } from "@/features/packages/current-offer-catalog";
import { resolveTemplateContent } from "./template-instantiation-service";

const catalog: CurrentOfferCatalog = {
  packages: {
    adventure_zone: { code: "adventure_zone", name: "Adventure Zone", priceCents: 900000, attractionCount: 10, marketingFootprint: "10,000–15,000 sq ft", customerDescription: "Full package", bookingTalkingPoints: "", operationalRequirements: "", setupNotes: "" },
    weekend_warriors: { code: "weekend_warriors", name: "Warrior's Playground", priceCents: 800000, attractionCount: 5, marketingFootprint: "7,000–10,000 sq ft", customerDescription: "Action package", bookingTalkingPoints: "", operationalRequirements: "", setupNotes: "" },
    pirates_rebellion: { code: "pirates_rebellion", name: "Pirate's Rebellion", priceCents: 800000, attractionCount: 3, marketingFootprint: "5,000–7,000 sq ft", customerDescription: "Water package", bookingTalkingPoints: "", operationalRequirements: "", setupNotes: "" },
    mini_zone: { code: "mini_zone", name: "Mini Zone", priceCents: 500000, attractionCount: 5, marketingFootprint: "3,000–5,000 sq ft", customerDescription: "Smaller package", bookingTalkingPoints: "", operationalRequirements: "", setupNotes: "" },
  },
  addOns: { foamParty: { code: "foam_party", name: "Foam Party Add-On", priceCents: 350000 } },
};

describe("template instantiation content", () => {
  it("snapshots current facts without inventing event fields", () => {
    const template = {
      id: crypto.randomUUID(),
      createdByAccountId: null,
      name: "Mini proposal",
      type: "proposal" as const,
      catalogKey: "proposal.prepaid.mini_zone",
      catalogRevision: 1,
      templateFamily: "proposal" as const,
      state: "active" as const,
      archivedAt: null,
      description: null,
      tags: [],
      visibility: "approved" as const,
      isApproved: true,
      lockedContent: { packageCode: "mini_zone" },
      content: "{{package_name}} {{package_price}} {{package_marketing_footprint}} {{event_name}}",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = resolveTemplateContent({ content: template.content, template, catalog, documentYear: 2028 });
    expect(result.content).toContain("Mini Zone $5,000 3,000–5,000 sq ft");
    expect(result.content).toContain("{{event_name}}");
    expect(result.snapshot).toMatchObject({
      selectedPackageCode: "mini_zone",
      documentYear: 2028,
    });
  });
});
