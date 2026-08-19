import { describe, expect, it } from "vitest";

import { selectBestFact } from "./lead-scout-evidence";
import type { LeadScoutEvidenceFact, LeadScoutSourceInput } from "./lead-scout-types";

const officialVendor: LeadScoutSourceInput = {
  url: "https://fair.example.org/vendors",
  title: "Official vendor application",
  publisher: "County Fair",
  category: "vendor_application",
  retrievedAt: "2026-08-19T18:00:00.000Z",
};

const publicSocial: LeadScoutSourceInput = {
  url: "https://facebook.com/events/example",
  title: "Public Facebook event",
  publisher: "Facebook",
  category: "social",
  retrievedAt: "2026-08-19T18:00:00.000Z",
};

function fact(overrides: Partial<LeadScoutEvidenceFact>): LeadScoutEvidenceFact {
  return {
    key: "vendor_deadline",
    value: "June 1, 2027",
    category: "vendor",
    confidence: "high",
    sourceUrls: [officialVendor.url],
    rationale: "Published by the organizer.",
    ...overrides,
  };
}

describe("selectBestFact", () => {
  it("prefers official vendor material over a contradictory public social post", () => {
    const selected = selectBestFact([
      fact({ value: "June 1, 2027", sourceUrls: [officialVendor.url], confidence: "high" }),
      fact({ value: "July 15, 2027", sourceUrls: [publicSocial.url], confidence: "high", rationale: "Public attendee post." }),
    ], [officialVendor, publicSocial]);

    expect(selected?.value).toBe("June 1, 2027");
    expect(selected?.sourceUrls).toEqual([officialVendor.url]);
  });

  it("does not elevate social-only hard schedule/contact facts above low confidence", () => {
    const selected = selectBestFact([
      fact({
        key: "organizer_phone",
        value: "555-0100",
        category: "contact",
        confidence: "high",
        sourceUrls: [publicSocial.url],
        rationale: "Listed in a public social post.",
      }),
    ], [publicSocial]);

    expect(selected?.confidence).toBe("low");
  });

  it("uses confidence as a tie breaker inside the same source authority", () => {
    const selected = selectBestFact([
      fact({ value: "June 1", confidence: "medium" }),
      fact({ value: "June 2", confidence: "high" }),
    ], [officialVendor]);

    expect(selected?.value).toBe("June 2");
  });
});
