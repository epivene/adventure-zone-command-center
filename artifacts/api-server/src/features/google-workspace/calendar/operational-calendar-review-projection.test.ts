import { describe, expect, it } from "vitest";

import { projectOperationalCalendarReview } from "./operational-calendar-review-projection";

describe("projectOperationalCalendarReview", () => {
  it("shows an unresolved David operational row on Schedule without inventing a booking id", () => {
    const event = projectOperationalCalendarReview({
      id: "review-1",
      googleEventId: "google-1",
      reason: "More than one existing event profile is a plausible calendar match.",
      bookingId: null,
      proposedChanges: {
        parsed: {
          managerToken: "KRISTY",
          eventName: "Eastern Montana Fair",
          city: "Miles City",
          region: "MT",
          packageKey: "zone",
          calendarState: "confirmed",
        },
        google: {
          summary: "KRISTY Eastern Montana Fair - Miles City MT (Zone)",
          startDate: "2026-08-19",
          endDateExclusive: "2026-08-24",
        },
      },
    });

    expect(event).toMatchObject({
      source: "google_operational_review",
      id: "google-review:review-1",
      googleEventId: "google-1",
      name: "Eastern Montana Fair · Needs profile match",
      city: "Miles City",
      region: "MT",
      status: "confirmed",
      travelLegName: "KRISTY",
      bookingId: null,
    });
    expect(event.startsAt.toISOString()).toBe("2026-08-19T00:00:00.000Z");
    expect(event.endsAt.toISOString()).toBe("2026-08-23T00:00:00.000Z");
  });

  it("preserves placeholder/cancelled/action-required state instead of making every unresolved row confirmed", () => {
    const base = {
      id: "review-2",
      googleEventId: "google-2",
      reason: "Needs review",
      bookingId: null,
    };

    for (const [calendarState, status] of [
      ["placeholder", "possible"],
      ["cancelled", "cancelled"],
      ["action_required", "researching"],
    ] as const) {
      const event = projectOperationalCalendarReview({
        ...base,
        proposedChanges: {
          parsed: { managerToken: null, eventName: "Pirate Fest", city: "Northglenn", region: "CO", packageKey: "pirates", calendarState },
          google: { summary: "Pirate Fest", startDate: "2026-09-16", endDateExclusive: "2026-09-21" },
        },
      });
      expect(event.status).toBe(status);
    }
  });
});
