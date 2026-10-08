import { expect, it } from "vitest";
import { parseBusinessDate, businessDateKey } from "./business-date";
it.each(["2026-03-08", "2026-11-01", "2028-02-29", "2026-12-31"])(
  "keeps the intended business day for %s across timezone and DST changes",
  (key) => {
    const date = parseBusinessDate(key);
    expect(date).not.toBeNull();
    expect(businessDateKey(date!)).toBe(key);
    expect(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        hour12: false,
      }).format(date!),
    ).toBe("12");
  },
);
it.each(["2026-02-29", "2026-02-30", "2026-13-01"])(
  "rejects invalid calendar day %s",
  (key) => expect(parseBusinessDate(key)).toBeNull(),
);
it.each([
  ["2026-01-15", "2026-01-15T18:00:00.000Z"],
  ["2026-07-15", "2026-07-15T17:00:00.000Z"],
  ["2026-03-08", "2026-03-08T17:00:00.000Z"],
  ["2026-11-01", "2026-11-01T18:00:00.000Z"],
])("converts %s to Chicago noon without parsing time-zone labels", (key, expected) => {
  expect(parseBusinessDate(key)?.toISOString()).toBe(expected);
});
