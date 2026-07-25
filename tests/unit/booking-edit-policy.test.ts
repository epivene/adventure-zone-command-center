import { describe, expect, it } from "vitest";

import { bookingEditPreservesFollowUpPlan } from "@/features/bookings/booking-edit-policy";

describe("booking edit follow-up invariant", () => {
  const now = new Date("2026-08-03T23:00:00.000Z");

  it("allows an active edit only with an incomplete future business-date action", () => {
    expect(
      bookingEditPreservesFollowUpPlan(
        "possible",
        [
          {
            dueAt: new Date("2026-08-04T17:00:00.000Z"),
            completedAt: null,
          },
        ],
        now,
      ),
    ).toBe(true);
    expect(bookingEditPreservesFollowUpPlan("possible", [], now)).toBe(false);
  });

  it("allows a closed status without a future action", () => {
    expect(bookingEditPreservesFollowUpPlan("declined", [], now)).toBe(true);
  });
});
