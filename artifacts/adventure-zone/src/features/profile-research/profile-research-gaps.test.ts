import { describe, expect, it } from "vitest";

import { profileResearchGaps } from "./profile-research-gaps";

describe("profileResearchGaps", () => {
  it("reports only meaningful missing booking-research information", () => {
    const now = new Date("2026-08-19T12:00:00Z");
    const gaps = profileResearchGaps({
      place: { website: null, phone: null, city: "Fargo", region: "ND" },
      contacts: [{ email: null, phone: null }],
      bookings: [{ startsAt: "2025-07-10T12:00:00Z" }],
    }, now);

    expect(gaps.map((gap) => gap.key)).toEqual([
      "website",
      "phone",
      "contact_method",
      "next_event_dates",
    ]);
  });

  it("returns no hint for a sufficiently complete profile with an upcoming event", () => {
    expect(profileResearchGaps({
      place: { website: "https://example.com", phone: "701-555-1212", city: "Fargo", region: "ND" },
      contacts: [{ email: "events@example.com", phone: null }],
      bookings: [{ startsAt: "2026-09-10T12:00:00Z" }],
    }, new Date("2026-08-19T12:00:00Z"))).toEqual([]);
  });
});
