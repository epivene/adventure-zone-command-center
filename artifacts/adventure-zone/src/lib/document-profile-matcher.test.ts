import { describe, expect, it } from "vitest";
import { buildProfileSearchQuery, chooseStrongProfileMatch, isProfileLinkCandidate } from "./document-profile-matcher";

const document = {
  displayName: "Great Northern Fair Havre MT 2025 Adventure SIGNED",
  originalFilename: "Great Northern Fair Havre MT 2025 Adventure SIGNED.pdf",
  category: "contract",
  links: [],
};

describe("document profile matcher", () => {
  it("removes filing noise while keeping the event and location", () => {
    expect(buildProfileSearchQuery(document)).toBe("Great Northern Fair Havre MT");
  });

  it("only scans event-specific documents without an existing profile link", () => {
    expect(isProfileLinkCandidate(document)).toBe(true);
    expect(isProfileLinkCandidate({ ...document, category: "marketing" })).toBe(false);
    expect(isProfileLinkCandidate({ ...document, links: [{ targetKind: "profile" }] })).toBe(false);
  });

  it("selects a unique profile when its name and location match", () => {
    expect(chooseStrongProfileMatch(document, [
      { id: "p1", name: "Great Northern Fair", city: "Havre", region: "MT" },
      { id: "p2", name: "Northern Lights Festival", city: "Helena", region: "MT" },
    ])).toEqual({
      profile: { id: "p1", name: "Great Northern Fair", city: "Havre", region: "MT" },
      confidence: 0.99,
      reason: "Profile name and location match the document name",
    });
  });

  it("refuses ambiguous and weak results", () => {
    expect(chooseStrongProfileMatch(document, [
      { id: "p1", name: "Great Northern Fair", city: "Havre", region: "MT" },
      { id: "p2", name: "Great Northern Fair", city: "Great Falls", region: "MT" },
    ])).toBeNull();
    expect(chooseStrongProfileMatch(document, [
      { id: "p3", name: "County Fair", city: "Missoula", region: "MT" },
    ])).toBeNull();
  });
});
