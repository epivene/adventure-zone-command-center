import { describe, expect, it } from "vitest";
import { packageTemplateInputSchema } from "./package-input";

describe("packageTemplateInputSchema", () => {
  it("accepts and lowercases canonical UUIDs with the installed Zod version", () => {
    const parsed = packageTemplateInputSchema.parse({
      id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      name: "Midway",
      basePriceCents: 800000,
      normalCapacity: 8,
      temporaryUnavailableQuantity: 0,
      baseAttractionCount: 8,
      minimumAttractionCount: 6,
      maximumAttractionCount: 10,
      baseDurationMinDays: 1,
      baseDurationMaxDays: 3,
      customerDescription: null,
      bookingTalkingPoints: null,
      operationalRequirements: null,
      setupNotes: null,
      knowledgeReviewNote: null,
      active: true,
    });

    expect(parsed.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
