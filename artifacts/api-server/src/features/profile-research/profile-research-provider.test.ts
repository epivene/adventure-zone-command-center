import { describe, expect, it } from "vitest";

import { boundedExcerpt, evaluateIdentityMatch, isSafeResearchUrl } from "./profile-research-matching";
import type { ProfileResearchContext } from "./profile-research-types";

const context: ProfileResearchContext = {
  profileId: "10000000-0000-4000-8000-000000000001",
  profileName: "River Days",
  mode: "quick",
  knownFacts: [
    { key: "city", value: "Fargo", source: "crm" },
    { key: "region", value: "ND", source: "crm" },
    { key: "contact:20000000-0000-4000-8000-000000000001", value: "Melissa Anderson · Events Coordinator", source: "crm" },
  ],
  searchClues: ["River Days Fargo ND"],
  gaps: [],
};

describe("profile research identity matching", () => {
  it("accepts an official matching event source as high confidence", () => {
    expect(evaluateIdentityMatch(context, {
      url: "https://riverdays.example/events",
      title: "River Days",
      name: "River Days",
      city: "Fargo",
      region: "ND",
      official: true,
      pageAccessible: true,
    })).toEqual(expect.objectContaining({ confidence: "high", writable: true }));
  });

  it("rejects a same-name event in the wrong state", () => {
    expect(evaluateIdentityMatch(context, {
      url: "https://example.org/river-days",
      title: "River Days",
      name: "River Days",
      city: "Fargo",
      region: "MN",
      pageAccessible: true,
    })).toEqual(expect.objectContaining({ confidence: "low", writable: false }));
  });

  it("lets a known organizer strengthen a non-official identity match", () => {
    expect(evaluateIdentityMatch(context, {
      url: "https://community.example/river-days",
      title: "River Days festival",
      name: "River Days",
      city: "Fargo",
      region: "ND",
      contactNames: ["Melissa Anderson"],
      pageAccessible: true,
    })).toEqual(expect.objectContaining({ confidence: "high", writable: true }));
  });

  it("does not treat an inaccessible search result as verified evidence", () => {
    expect(evaluateIdentityMatch(context, {
      url: "https://dead.example/river-days",
      title: "River Days",
      name: "River Days",
      city: "Fargo",
      region: "ND",
      official: true,
      pageAccessible: false,
    })).toEqual(expect.objectContaining({ confidence: "low", writable: false }));
  });

  it("accepts only public http(s) evidence URLs and strips HTML from excerpts", () => {
    expect(isSafeResearchUrl("https://example.com/event")).toBe(true);
    expect(isSafeResearchUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeResearchUrl("file:///etc/passwd")).toBe(false);
    expect(boundedExcerpt("<p>Hello <strong>River Days</strong></p>")).toBe("Hello River Days");
  });
});
