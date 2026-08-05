import { describe, expect, it } from "vitest";

import {
  calculateBackoffMs,
  calculateRetryAt,
  parseRetryAfter,
} from "./retry-policy";

describe("Act replacement retry policy", () => {
  it.each([
    [1, 5_000],
    [2, 10_000],
    [3, 20_000],
    [6, 160_000],
    [7, 300_000],
    [30, 300_000],
  ])("uses bounded exponential backoff for attempt %i", (attempt, expected) => {
    expect(calculateBackoffMs(attempt)).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid attempt count %s without reflecting it in the error",
    (attempt) => {
      expect(() => calculateBackoffMs(attempt)).toThrowError(
        "Act retry attempt count is invalid.",
      );
    },
  );

  it("parses a Retry-After delta without treating it as a date", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");

    expect(parseRetryAfter("90", now)).toEqual(
      new Date("2026-08-01T12:01:30.000Z"),
    );
  });

  it("parses a valid Retry-After HTTP date", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");

    expect(parseRetryAfter("Sat, 01 Aug 2026 12:08:00 GMT", now)).toEqual(
      new Date("2026-08-01T12:08:00.000Z"),
    );
  });

  it.each([null, "", "1.5", "later", "Sun, 32 Aug 2026 12:00:00 GMT"])(
    "ignores invalid Retry-After value %s",
    (value) => {
      expect(
        parseRetryAfter(value, new Date("2026-08-01T12:00:00.000Z")),
      ).toBeNull();
    },
  );

  it("chooses a later valid Retry-After over exponential backoff", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");

    expect(
      calculateRetryAt({
        attemptCount: 2,
        now,
        retryAfter: new Date("2026-08-01T12:02:00.000Z"),
      }),
    ).toEqual(new Date("2026-08-01T12:02:00.000Z"));
  });

  it("keeps later exponential backoff when Retry-After is earlier", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");

    expect(
      calculateRetryAt({
        attemptCount: 4,
        now,
        retryAfter: new Date("2026-08-01T12:00:10.000Z"),
      }),
    ).toEqual(new Date("2026-08-01T12:00:40.000Z"));
  });

  it("caps a later Retry-After at fifteen minutes", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");

    expect(
      calculateRetryAt({
        attemptCount: 1,
        now,
        retryAfter: new Date("2026-08-01T14:00:00.000Z"),
      }),
    ).toEqual(new Date("2026-08-01T12:15:00.000Z"));
  });

  it("ignores invalid retry dates", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");

    expect(
      calculateRetryAt({
        attemptCount: 1,
        now,
        retryAfter: new Date(Number.NaN),
      }),
    ).toEqual(new Date("2026-08-01T12:00:05.000Z"));
  });
});
