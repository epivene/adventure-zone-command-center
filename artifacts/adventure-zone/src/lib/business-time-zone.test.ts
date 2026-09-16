import { describe, expect, it } from "vitest";

import {
  businessLocalInputToUtc,
  formatBusinessSchedule,
} from "./business-time-zone";

describe("business timezone scheduling", () => {
  it("converts a unique Denver local time to UTC", () => {
    expect(
      businessLocalInputToUtc({
        localDateTime: "2026-09-14T12:30",
        timeZone: "America/Denver",
      }),
    ).toBe("2026-09-14T18:30:00.000Z");
  });

  it("rejects nonexistent, ambiguous, and invalid business times", () => {
    expect(() =>
      businessLocalInputToUtc({
        localDateTime: "2026-03-08T02:30",
        timeZone: "America/Denver",
      }),
    ).toThrow("BUSINESS_LOCAL_TIME_AMBIGUOUS_OR_MISSING");
    expect(() =>
      businessLocalInputToUtc({
        localDateTime: "2026-11-01T01:30",
        timeZone: "America/Denver",
      }),
    ).toThrow("BUSINESS_LOCAL_TIME_AMBIGUOUS_OR_MISSING");
    expect(() =>
      businessLocalInputToUtc({
        localDateTime: "2026-09-14T12:30",
        timeZone: "Mars/Olympus",
      }),
    ).toThrow("BUSINESS_TIME_ZONE_INVALID");
  });

  it("formats a stored UTC schedule in the explicit business timezone", () => {
    expect(
      formatBusinessSchedule({
        utcDateTime: "2026-09-14T18:30:00.000Z",
        timeZone: "America/Denver",
      }),
    ).toMatch(/Sep 14, 2026.*12:30 PM.*MDT/);
  });
});
