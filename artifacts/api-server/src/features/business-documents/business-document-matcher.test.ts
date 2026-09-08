import { describe, expect, it } from "vitest";

import { matchBusinessDocument } from "./business-document-matcher";

describe("matchBusinessDocument", () => {
  it("auto-links an approved Gmail thread/profile relationship", () => {
    expect(matchBusinessDocument({ approvedThreadProfileId: "profile-1", exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: [] })).toEqual([
      expect.objectContaining({ targetKind: "profile", targetId: "profile-1", decision: "auto", confidence: 1 }),
    ]);
  });

  it("auto-links one exact known contact email", () => {
    expect(matchBusinessDocument({ approvedThreadProfileId: null, exactEmailProfileIds: ["profile-2"], exactEventMatches: [], fuzzyNameMatches: [] })).toEqual([
      expect.objectContaining({ targetId: "profile-2", decision: "auto" }),
    ]);
  });

  it("never auto-links on fuzzy name similarity alone", () => {
    const proposals = matchBusinessDocument({ approvedThreadProfileId: null, exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: ["profile-3"] });
    expect(proposals).toEqual([expect.objectContaining({ targetId: "profile-3", decision: "review" })]);
  });

  it("routes conflicting strong signals to review", () => {
    const proposals = matchBusinessDocument({ approvedThreadProfileId: "profile-1", exactEmailProfileIds: ["profile-2"], exactEventMatches: [], fuzzyNameMatches: [] });
    expect(proposals).toHaveLength(2);
    expect(proposals.every((proposal) => proposal.decision === "review")).toBe(true);
  });
});
