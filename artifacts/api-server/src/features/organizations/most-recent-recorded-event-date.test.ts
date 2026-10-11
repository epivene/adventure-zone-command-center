import { describe, expect, it } from "vitest";
import { resolveMostRecentRecordedEventDate } from "./most-recent-recorded-event-date";

describe("resolveMostRecentRecordedEventDate", () => {
  it("includes the latest saved Festival edition even when its date is in the past", () => {
    expect(resolveMostRecentRecordedEventDate({
      bookings: [{ id: "booking-1", startsOn: "2024-06-10", endsOn: "2024-06-11", status: "completed" }],
      facts: [{ id: "fact-1", startsOn: "2025-06-10", endsOn: null, status: "confirmed", active: true }],
      editions: [
        { details: { startsOn: "2025-06-10", endsOn: "2025-06-12" } },
        { details: { startsOn: "2026-06-10", endsOn: "2026-06-12" } },
      ],
    })).toEqual({
      startsOn: "2026-06-10",
      endsOn: "2026-06-12",
      source: "festival_edition",
    });
  });

  it("chooses the latest date across bookings, active facts, and edition records", () => {
    expect(resolveMostRecentRecordedEventDate({
      bookings: [{ id: "booking-1", startsOn: "2026-07-10", endsOn: null, status: "confirmed" }],
      facts: [{ id: "fact-1", startsOn: "2026-08-10", endsOn: null, status: "expected", active: true }],
      editions: [{ details: { startsOn: "2026-09-10", endsOn: null } }],
    })).toEqual({
      startsOn: "2026-09-10",
      endsOn: null,
      source: "festival_edition",
    });
  });

  it("ignores cancelled bookings, inactive or review-only facts, and invalid dates", () => {
    expect(resolveMostRecentRecordedEventDate({
      bookings: [
        { id: "cancelled", startsOn: "2026-09-10", endsOn: null, status: "cancelled" },
        { id: "invalid", startsOn: "2026-13-40", endsOn: null, status: "confirmed" },
      ],
      facts: [
        { id: "inactive", startsOn: "2026-09-10", endsOn: null, status: "confirmed", active: false },
        { id: "review", startsOn: "2026-09-11", endsOn: null, status: "needs_review", active: true },
      ],
      editions: [{ details: { startsOn: "not-a-date" } }],
    })).toBeNull();
  });
});
