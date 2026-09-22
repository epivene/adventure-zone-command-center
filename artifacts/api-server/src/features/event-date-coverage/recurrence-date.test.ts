import { describe, expect, it } from "vitest";

import { calculateNextRecurrence } from "./recurrence-date";

describe("calculateNextRecurrence", () => {
  it("rolls an annual date into the next year and preserves a multi-day range", () => {
    expect(calculateNextRecurrence({
      today: "2026-09-21",
      rule: { kind: "annual_date", month: 9, day: 5, durationDays: 3 },
    })).toEqual({
      status: "expected",
      startsOn: "2027-09-05",
      endsOn: "2027-09-07",
      calculationYear: 2027,
    });
  });

  it("calculates an ordinal weekday without local-time conversion", () => {
    expect(calculateNextRecurrence({
      today: "2026-01-01",
      rule: {
        kind: "ordinal_weekday",
        month: 9,
        ordinal: 1,
        weekday: 6,
        durationDays: 2,
      },
    })).toEqual({
      status: "expected",
      startsOn: "2026-09-05",
      endsOn: "2026-09-06",
      calculationYear: 2026,
    });
  });

  it("finds the next valid leap-day occurrence", () => {
    expect(calculateNextRecurrence({
      today: "2027-03-01",
      rule: { kind: "annual_date", month: 2, day: 29, durationDays: 1 },
    })).toEqual({
      status: "expected",
      startsOn: "2028-02-29",
      endsOn: null,
      calculationYear: 2028,
    });
  });

  it.each([
    {
      rule: { kind: "annual_date", month: 13, day: 1, durationDays: 1 } as const,
      reason: "invalid_rule",
    },
    {
      rule: { kind: "ordinal_weekday", month: 2, ordinal: 5, weekday: 1, durationDays: 1 } as const,
      reason: "date_not_available",
    },
    {
      rule: { kind: "unrecognized", raw: "sometime next fall" } as const,
      reason: "ambiguous_rule",
    },
  ])("returns needs review instead of guessing for $reason", ({ rule, reason }) => {
    expect(calculateNextRecurrence({
      today: "2026-01-01",
      rule,
    })).toEqual({ status: "needs_review", reason });
  });
});
