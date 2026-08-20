import { describe, expect, it } from "vitest";

import { profileSummaryDetails } from "./profile-summary-details";

describe("profileSummaryDetails", () => {
  it("keeps mailing and event venue locations distinct and prefers the next upcoming event", () => {
    const now = new Date("2026-08-20T15:00:00.000Z");
    const details = profileSummaryDetails({
      now,
      place: {
        address1: "PO Box 44",
        address2: null,
        city: "Bismarck",
        region: "ND",
        postalCode: "58501",
      },
      bookings: [
        {
          name: "Last year's fair",
          venueName: "Old Fairgrounds",
          address1: "1 Old Rd",
          city: "Mandan",
          region: "ND",
          postalCode: "58554",
          startsAt: new Date("2025-07-01T18:00:00.000Z"),
        },
        {
          name: "Fall Festival",
          venueName: "Main Street Park",
          address1: "200 Main St",
          city: "Dickinson",
          region: "ND",
          postalCode: "58601",
          startsAt: new Date("2026-09-05T18:00:00.000Z"),
        },
      ],
    });

    expect(details.mailingAddress).toBe("PO Box 44\nBismarck, ND 58501");
    expect(details.venueLabel).toBe("Main Street Park");
    expect(details.venueAddress).toBe("200 Main St\nDickinson, ND 58601");
    expect(details.venueBookingName).toBe("Fall Festival");
  });

  it("falls back to the most recent event when no future event exists", () => {
    const details = profileSummaryDetails({
      now: new Date("2026-08-20T15:00:00.000Z"),
      place: { address1: null, address2: null, city: null, region: null, postalCode: null },
      bookings: [
        { name: "Older", venueName: null, address1: null, city: "Minot", region: "ND", postalCode: null, startsAt: new Date("2024-06-01T00:00:00.000Z") },
        { name: "Recent", venueName: null, address1: null, city: "Williston", region: "ND", postalCode: null, startsAt: new Date("2026-06-01T00:00:00.000Z") },
      ],
    });

    expect(details.venueBookingName).toBe("Recent");
    expect(details.venueAddress).toBe("Williston, ND");
  });
});
