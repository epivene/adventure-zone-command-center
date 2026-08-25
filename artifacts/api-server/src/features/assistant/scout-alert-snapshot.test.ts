import { describe, expect, it } from "vitest";

import {
  baselineScoutAlertSnapshot,
  researchedScoutAlertSnapshot,
} from "./scout-alert-snapshot";
import type {
  LeadScoutCandidateView,
  LeadScoutEvidenceFact,
  LeadScoutSourceInput,
} from "./lead-scout-types";

const official: LeadScoutSourceInput = {
  url: "https://example.org/fair",
  title: "Official fair page",
  publisher: "Twin Falls County Fair",
  category: "official_event",
  retrievedAt: "2026-08-25T12:00:00.000Z",
};
const vendor: LeadScoutSourceInput = {
  url: "https://example.org/fair/vendors",
  title: "Vendor application",
  publisher: "Twin Falls County Fair",
  category: "vendor_application",
  retrievedAt: "2026-08-25T12:00:00.000Z",
};
const social: LeadScoutSourceInput = {
  url: "https://social.example/fair",
  title: "Public social post",
  publisher: "Social",
  category: "social",
  retrievedAt: "2026-08-25T12:00:00.000Z",
};

function candidate(overrides: Partial<LeadScoutCandidateView> = {}): LeadScoutCandidateView {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Twin Falls County Fair",
    city: "Filer",
    region: "ID",
    venue: "Twin Falls County Fairgrounds",
    startsAt: "2026-09-02",
    endsAt: "2026-09-07",
    organizerName: "Fair Office",
    organizerEmail: "FAIR@example.org",
    organizerPhone: "(208) 555-0100",
    website: official.url,
    eventType: "county fair",
    recurrenceSummary: "Annual Labor Day fair",
    attendanceSummary: null,
    vendorSummary: "Vendor applications are open at https://example.org/fair/vendors",
    applicationDeadline: "2026-08-30",
    fitScore: 87,
    fitRationale: "Strong family fit",
    fitReasons: [],
    fitCautions: [],
    crmMatchStatus: "new_prospect",
    matchedOrganizationId: null,
    matchedBookingId: null,
    reviewStatus: "unreviewed",
    enrichmentStatus: "enriched",
    coverageGaps: ["Power requirements were not published."],
    enrichmentError: null,
    enrichedAt: "2026-08-25T12:00:00.000Z",
    deepenRequestedAt: null,
    savedOrganizationId: null,
    savedBookingId: null,
    facts: [],
    ...overrides,
  };
}

function fact(overrides: Partial<LeadScoutEvidenceFact>): LeadScoutEvidenceFact {
  return {
    key: "fact",
    value: "value",
    category: "identity",
    confidence: "high",
    sourceUrls: [official.url],
    rationale: "Official source",
    ...overrides,
  };
}

describe("baselineScoutAlertSnapshot", () => {
  it("normalizes saved candidate dates, deadline, organizer contact, and gaps", () => {
    const snapshot = baselineScoutAlertSnapshot({
      candidate: candidate(),
      sources: [official, vendor],
      now: new Date("2026-08-25T12:30:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      startsAt: "2026-09-02",
      endsAt: "2026-09-07",
      applicationAvailable: true,
      applicationUrl: vendor.url,
      applicationDeadline: "2026-08-30",
      organizerName: "Fair Office",
      organizerEmail: "fair@example.org",
      organizerPhone: "208-555-0100",
      coverageGaps: ["Power requirements were not published."],
      capturedAt: "2026-08-25T12:30:00.000Z",
    });
    expect(snapshot.sources.map((source) => source.url)).toEqual([official.url, vendor.url]);
  });

  it("does not invent an application path from generic vendor prose without a safe source URL", () => {
    const snapshot = baselineScoutAlertSnapshot({
      candidate: candidate({
        website: official.url,
        vendorSummary: "The event usually has food vendors.",
      }),
      sources: [official],
      now: new Date("2026-08-25T12:30:00.000Z"),
    });

    expect(snapshot.applicationAvailable).toBe(false);
    expect(snapshot.applicationUrl).toBeNull();
  });
});

describe("researchedScoutAlertSnapshot", () => {
  it("selects reliable schedule, deadline, application, and organizer facts", () => {
    const snapshot = researchedScoutAlertSnapshot({
      candidate: candidate({ startsAt: null, endsAt: null, applicationDeadline: null }),
      facts: [
        fact({ key: "event_dates", value: "September 3-8, 2026", category: "schedule" }),
        fact({ key: "application_deadline", value: "Apply by 2026-08-31", category: "vendor", sourceUrls: [vendor.url] }),
        fact({ key: "vendor_application", value: vendor.url, category: "vendor", sourceUrls: [vendor.url] }),
        fact({ key: "organizer_name", value: "County Fair Office", category: "contact" }),
        fact({ key: "organizer_email", value: "EVENTS@EXAMPLE.ORG", category: "contact" }),
        fact({ key: "organizer_phone", value: "+1 (208) 555-0101", category: "contact" }),
      ],
      sources: [official, vendor],
      coverageGaps: ["Insurance requirements still need confirmation."],
      now: new Date("2026-08-26T12:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      startsAt: "2026-09-03",
      endsAt: "2026-09-08",
      applicationAvailable: true,
      applicationUrl: vendor.url,
      applicationDeadline: "2026-08-31",
      organizerName: "County Fair Office",
      organizerEmail: "events@example.org",
      organizerPhone: "208-555-0101",
      coverageGaps: ["Insurance requirements still need confirmation."],
    });
  });

  it("uses two ISO dates from one reliable schedule fact as start and end", () => {
    const snapshot = researchedScoutAlertSnapshot({
      candidate: candidate({ startsAt: null, endsAt: null }),
      facts: [fact({
        key: "confirmed_event_date_range",
        value: "Runs 2026-09-04 through 2026-09-09",
        category: "schedule",
      })],
      sources: [official],
      coverageGaps: [],
      now: new Date("2026-08-26T12:00:00.000Z"),
    });

    expect(snapshot.startsAt).toBe("2026-09-04");
    expect(snapshot.endsAt).toBe("2026-09-09");
  });

  it("does not let low-confidence social evidence replace hard fields", () => {
    const snapshot = researchedScoutAlertSnapshot({
      candidate: candidate(),
      facts: [
        fact({
          key: "event_dates",
          value: "2026-10-10 through 2026-10-12",
          category: "schedule",
          confidence: "low",
          sourceUrls: [social.url],
        }),
        fact({
          key: "organizer_email",
          value: "rumor@example.org",
          category: "contact",
          confidence: "medium",
          sourceUrls: [social.url],
        }),
      ],
      sources: [official, social],
      coverageGaps: candidate().coverageGaps,
      now: new Date("2026-08-26T12:00:00.000Z"),
    });

    expect(snapshot.startsAt).toBe("2026-09-02");
    expect(snapshot.endsAt).toBe("2026-09-07");
    expect(snapshot.organizerEmail).toBe("fair@example.org");
  });

  it("drops unsafe URLs and deduplicates and bounds sources", () => {
    const repeated = Array.from({ length: 15 }, (_, index): LeadScoutSourceInput => ({
      ...official,
      url: `https://example.org/source-${index}`,
      title: `Source ${index}`,
    }));
    const snapshot = researchedScoutAlertSnapshot({
      candidate: candidate(),
      facts: [fact({
        key: "vendor_application",
        value: "javascript:alert(1)",
        category: "vendor",
      })],
      sources: [
        ...repeated,
        repeated[0]!,
        { ...official, url: "javascript:alert(1)" },
      ],
      coverageGaps: [],
      now: new Date("2026-08-26T12:00:00.000Z"),
    });

    expect(snapshot.applicationUrl).toBe(vendor.url);
    expect(snapshot.sources).toHaveLength(12);
    expect(new Set(snapshot.sources.map((source) => source.url)).size).toBe(12);
    expect(snapshot.sources.some((source) => source.url.startsWith("javascript:"))).toBe(false);
  });
});
