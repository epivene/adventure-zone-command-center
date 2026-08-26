import { describe, expect, it } from "vitest";

import { packageTemplateInputSchema } from "./package-input";

const baseInput = {
  id: "4fbc77e5-5453-42af-9316-b0ea6ca91ae5",
  name: "Adventure Zone",
  baseAttractionCount: 10,
  normalCapacity: 5,
  temporaryUnavailableQuantity: 0,
  minimumAttractionCount: 10,
  maximumAttractionCount: 12,
  customerDescription: null,
  bookingTalkingPoints: null,
  operationalRequirements: null,
  setupNotes: null,
  active: true,
};

describe("package base price", () => {
  it("accepts an editable price in cents or a blank price", () => {
    expect(packageTemplateInputSchema.parse({ ...baseInput, basePriceCents: 800000 }).basePriceCents).toBe(800000);
    expect(packageTemplateInputSchema.parse({ ...baseInput, basePriceCents: null }).basePriceCents).toBeNull();
  });

  it("rejects negative or fractional prices", () => {
    expect(packageTemplateInputSchema.safeParse({ ...baseInput, basePriceCents: -1 }).success).toBe(false);
    expect(packageTemplateInputSchema.safeParse({ ...baseInput, basePriceCents: 799999.5 }).success).toBe(false);
  });
});
