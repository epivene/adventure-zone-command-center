import { expect, it } from "vitest";
import { resolveOperationalWindow } from "./operational-window";

it("preserves an exclusive Google date end at Denver midnight", () => {
  expect(
    resolveOperationalWindow({
      startsAt: "2027-07-21",
      endsAt: "2027-07-26",
      semantics: "exclusive_date",
      source: "google",
    }),
  ).toEqual({
    state: "resolved",
    window: {
      startMs: Date.parse("2027-07-21T06:00:00Z"),
      endMs: Date.parse("2027-07-26T06:00:00Z"),
      source: "google",
    },
  });
});
it("includes the last business day across the spring daylight-saving change", () => {
  const result = resolveOperationalWindow({
    startsAt: "2027-03-13",
    endsAt: "2027-03-14",
    semantics: "inclusive_date",
    source: "contract",
  });
  expect(result).toEqual({
    state: "resolved",
    window: {
      startMs: Date.parse("2027-03-13T07:00:00Z"),
      endMs: Date.parse("2027-03-15T06:00:00Z"),
      source: "contract",
    },
  });
});
it("retains timestamps and cross-year intervals without changing their season", () => {
  expect(
    resolveOperationalWindow({
      startsAt: "2026-12-31T23:00:00-07:00",
      endsAt: "2027-01-02T02:00:00-07:00",
      semantics: "timestamp",
      source: "operator",
    }),
  ).toEqual({
    state: "resolved",
    window: {
      startMs: Date.parse("2027-01-01T06:00:00Z"),
      endMs: Date.parse("2027-01-02T09:00:00Z"),
      source: "operator",
    },
  });
});
it.each([
  ["2027-07-21", "9999-12-31", "inclusive_date"],
  ["2027-07-22", "2027-07-21", "inclusive_date"],
  ["2027-02-30", "2027-03-02", "inclusive_date"],
  [null, "2027-07-21", "exclusive_date"],
  ["2027-07-21", "2027-07-26", "timestamp"],
])(
  "requires review for invalid or ambiguous windows %s %s %s",
  (startsAt, endsAt, semantics) => {
    expect(
      resolveOperationalWindow({
        startsAt,
        endsAt,
        semantics: semantics as "timestamp",
        source: "source",
      }).state,
    ).toBe("needs_review");
  },
);
