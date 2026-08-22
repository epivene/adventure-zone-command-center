import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  path.resolve(process.cwd(), "src/features/communication-templates/communication-template-service.ts"),
  "utf8",
);
const officeRoute = readFileSync(
  path.resolve(process.cwd(), "src/routes/office-communication-templates.ts"),
  "utf8",
);

describe("commercial offer template guard", () => {
  it("requires explicit internal use context before a renderer can use an offer", () => {
    expect(service).toContain("commercialOfferId?: string | null");
    expect(service).toContain("commercialOfferContext?: CommercialOfferUseContext | null");
    expect(service).toContain("COMMERCIAL_OFFER_CONTEXT_REQUIRED");
    expect(service).toContain("canUseCommercialOffer");
    expect(service).toContain("COMMERCIAL_OFFER_NOT_ALLOWED");
  });

  it("keeps commercial offer IDs outside the strict Office render request", () => {
    expect(officeRoute).toContain(".strict()");
    expect(officeRoute).not.toContain("commercialOfferId");
  });
});
