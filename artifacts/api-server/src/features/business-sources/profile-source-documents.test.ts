import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/business-sources/profile-source-documents.ts", "utf8");

describe("profile source document projection", () => {
  it("includes direct profile, profile-location, and booking document links", () => {
    expect(source).toContain("businessSourceDocumentLinks.organizationId");
    expect(source).toContain("organizationLocations.id");
    expect(source).toContain("bookings.id");
  });

  it("filters Office metadata on source access scope before returning it", () => {
    expect(source).toContain('scope === "office"');
    expect(source).toContain('eq(businessSourceDocuments.accessScope, "office")');
  });

  it("returns only approved historical terms and never exposes storage keys", () => {
    expect(source).toContain('eq(businessSourceHistoricalTerms.reviewState, "approved")');
    expect(source).toContain("hasFile");
    expect(source).not.toContain("storageKey:");
  });
});
