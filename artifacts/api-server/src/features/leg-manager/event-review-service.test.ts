import { describe, expect, it } from "vitest";
import { isEventReviewDue, validateEventReviewRating } from "./event-review-service";

const now = new Date("2026-08-15T18:00:00Z"); // Aug 15, 1:00 PM America/Chicago

describe("isEventReviewDue", () => {
  it("does not mark a future event due", () => {
    expect(isEventReviewDue({ startsAt: new Date("2026-08-16T16:00:00Z"), endsAt: null }, now)).toBe(false);
  });

  it("does not mark an event ending today due yet", () => {
    expect(isEventReviewDue({ startsAt: new Date("2026-08-14T16:00:00Z"), endsAt: new Date("2026-08-15T23:00:00Z") }, now)).toBe(false);
  });

  it("marks a completed event from yesterday due", () => {
    expect(isEventReviewDue({ startsAt: new Date("2026-08-14T16:00:00Z"), endsAt: new Date("2026-08-14T23:00:00Z") }, now)).toBe(true);
  });

  it("uses the end date for multi-day events", () => {
    expect(isEventReviewDue({ startsAt: new Date("2026-08-13T16:00:00Z"), endsAt: new Date("2026-08-15T22:00:00Z") }, now)).toBe(false);
  });

  it("falls back to start date when end date is missing", () => {
    expect(isEventReviewDue({ startsAt: new Date("2026-08-14T16:00:00Z"), endsAt: null }, now)).toBe(true);
  });
});

describe("validateEventReviewRating", () => {
  it("accepts integer ratings 0 through 5", () => {
    for (const rating of [0, 1, 2, 3, 4, 5]) expect(validateEventReviewRating(rating)).toBe(true);
  });
  it("rejects ratings outside 0 through 5", () => {
    expect(validateEventReviewRating(-1)).toBe(false);
    expect(validateEventReviewRating(6)).toBe(false);
    expect(validateEventReviewRating(3.5)).toBe(false);
  });
});
