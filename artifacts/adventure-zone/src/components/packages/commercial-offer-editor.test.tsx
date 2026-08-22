import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/packages/commercial-offer-editor.tsx", "utf8");

describe("commercial offer editor", () => {
  it("shows review state, owner-only scope, conflicts, and explicit activation", () => {
    for (const text of ["Offers & Discounts", "Owner only", "Source conflict", "Activate", "Archive"]){
      expect(source).toContain(text);
    }
  });

  it("requires an explicit confirmation gesture before clearing a source conflict", () => {
    expect(source).toContain("I confirmed the current terms");
    expect(source).toContain('set("sourceConflictNote",null)');
  });

  it("sends only editable rule fields when saving", () => {
    expect(source).toContain("editableOfferPayload");
    expect(source).toContain("apiPatch(`/commercial-offers/${offer.id}`,editableOfferPayload(offer))");
    expect(source).not.toContain("apiPatch(`/commercial-offers/${offer.id}`,offer)");
  });
});
