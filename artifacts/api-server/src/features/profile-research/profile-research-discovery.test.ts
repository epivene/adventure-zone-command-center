import { describe, expect, it } from "vitest";

import { normalizeRelatedEvent, summarizeResearchFinding } from "./profile-research-discovery";

describe("profile research discovery normalization", () => {
  it("keeps useful non-writable findings about the researched event", () => {
    expect(summarizeResearchFinding({
      label: "2026 dates",
      value: "June 11–13, 2026",
      rationale: "Published on the official Breckenridge event page.",
      sourceUrls: ["https://gobreck.com/event/breck-pride"],
    })).toEqual({
      label: "2026 dates",
      value: "June 11–13, 2026",
      rationale: "Published on the official Breckenridge event page.",
      sourceUrls: ["https://gobreck.com/event/breck-pride"],
    });
  });

  it("normalizes related event opportunities from a broader event directory", () => {
    expect(normalizeRelatedEvent({
      name: "Breckenridge Bluegrass + Beer Festival",
      city: "Breckenridge",
      region: "CO",
      startsAt: "2026-09-11",
      endsAt: "2026-09-13",
      venue: "Main Street Station",
      url: "https://gobreck.com/event/bluegrass-beer",
      rationale: "Found on the same official Breckenridge seasonal events calendar.",
    })).toEqual(expect.objectContaining({
      name: "Breckenridge Bluegrass + Beer Festival",
      city: "Breckenridge",
      region: "CO",
      startsAt: "2026-09-11",
      endsAt: "2026-09-13",
      venue: "Main Street Station",
      url: "https://gobreck.com/event/bluegrass-beer",
    }));
  });

  it("drops unusable event discoveries without a name or public source", () => {
    expect(normalizeRelatedEvent({ name: "", url: "https://example.com" })).toBeNull();
    expect(normalizeRelatedEvent({ name: "Mystery Festival", url: "javascript:alert(1)" })).toBeNull();
  });
});
