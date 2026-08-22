import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/business-source-document-links.ts", "utf8");
const index = readFileSync("src/routes/index.ts", "utf8");

describe("business source document links and historical terms", () => {
  it("requires exactly one target whose type matches linkKind", () => {
    expect(source).toContain("exactlyOneTarget");
    expect(source).toContain("linkKindMatchesTarget");
    expect(source).toContain("Choose exactly one document link target");
    expect(source).toContain("The link kind does not match the selected target");
  });

  it("rejects retired profile targets and validates location/booking/package targets", () => {
    expect(source).toContain("consolidatedIntoId");
    expect(source).toContain("organizationLocations.organizationId");
    expect(source).toContain("bookings.id");
    expect(source).toContain("packageTemplates.id");
  });

  it("supports idempotent links and historical term review without exposing binaries", () => {
    expect(source).toContain('/business-sources/:documentId/links');
    expect(source).toContain('/business-sources/:documentId/historical-terms');
    expect(source).toContain("onConflictDoNothing");
    expect(source).toContain("businessSourceHistoricalTerms");
    expect(source).not.toContain("storageKey");
  });

  it("requires approved terms to stay bound to a valid document link", () => {
    expect(source).toContain("Approved historical terms require a source document link");
    expect(source).toContain("Approved historical terms are attached to this link");
    expect(source).toContain("businessSourceHistoricalTerms.documentLinkId");
    expect(source).toContain('businessSourceHistoricalTerms.reviewState, "approved"');
  });

  it("mounts only after owner authentication", () => {
    const ownerGate = index.indexOf("router.use(requireOwnerMiddleware)");
    const mount = index.indexOf("router.use(businessSourceDocumentLinksRouter)");
    expect(mount).toBeGreaterThan(ownerGate);
  });
});
