import { describe, expect, it } from "vitest";

import { buildManagerReviewOverview } from "./manager-review-overview";

const now = new Date("2026-09-01T18:00:00Z");

const bookings = [
  {
    id: "old-a",
    name: "Moorcroft Jubilee Days",
    city: "Moorcroft",
    region: "WY",
    startsAt: new Date("2026-07-09T14:00:00Z"),
    endsAt: new Date("2026-07-11T23:00:00Z"),
    status: "completed",
  },
  {
    id: "old-b",
    name: "Sublette County Fair",
    city: "Big Piney",
    region: "WY",
    startsAt: new Date("2026-07-24T14:00:00Z"),
    endsAt: new Date("2026-07-26T23:00:00Z"),
    status: "completed",
  },
  {
    id: "miles-city",
    name: "Eastern Montana Fair",
    city: "Miles City",
    region: "MT",
    startsAt: new Date("2026-08-20T14:00:00Z"),
    endsAt: new Date("2026-08-23T23:00:00Z"),
    status: "completed",
  },
  {
    id: "don-king-days",
    name: "Don King Days",
    city: "Sheridan",
    region: "WY",
    startsAt: new Date("2026-09-04T17:00:00Z"),
    endsAt: new Date("2026-09-05T17:00:00Z"),
    status: "new_lead",
  },
  {
    id: "meeteetse",
    name: "Meeteetse Annual Labor Day Celebration 2026",
    city: "Meeteetse",
    region: "WY",
    startsAt: new Date("2026-09-05T17:00:00Z"),
    endsAt: new Date("2026-09-07T17:00:00Z"),
    status: "confirmed",
  },
  {
    id: "later-event",
    name: "Later September Event",
    city: "Somewhere",
    region: "WY",
    startsAt: new Date("2026-09-18T14:00:00Z"),
    endsAt: new Date("2026-09-20T23:00:00Z"),
    status: "confirmed",
  },
];

const reviews = [
  {
    id: "review-miles-city",
    bookingId: "miles-city",
    rating: 5,
    feedback: "Good event",
    organizerSiteNotes: null,
    crewNotes: null,
    recommendReturn: "yes",
    createdAt: new Date("2026-08-24T12:00:00Z"),
  },
];

describe("buildManagerReviewOverview", () => {
  it("keeps the newest completed report visible, hides dismissed stale prompts, and shows the next confirmed event", () => {
    const overview = buildManagerReviewOverview({
      bookings,
      reviews,
      dismissedBookingIds: new Set(["old-a", "old-b"]),
      now,
    });

    expect(overview.reviewsDue).toEqual([]);
    expect(overview.recentCompleted?.event.id).toBe("miles-city");
    expect(overview.recentCompleted?.review.id).toBe("review-miles-city");
    expect(overview.nextUpcoming?.id).toBe("meeteetse");
  });

  it("still returns a real unreviewed, undismissed past event as due", () => {
    const overview = buildManagerReviewOverview({
      bookings,
      reviews,
      dismissedBookingIds: new Set(["old-a"]),
      now,
    });

    expect(overview.reviewsDue.map((event) => event.id)).toEqual(["old-b"]);
  });
});
