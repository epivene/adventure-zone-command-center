import { describe, expect, it } from "vitest";

import { findExactOperationalCalendarEvent } from "./operational-calendar-existing-event";

const expected = {
  id: "existing-meeteetse-zone",
  etag: '"one"',
  summary: "KRISTY Meeteetse Annual Labor Day Celebration 2026 - Meeteetse WY (Zone)",
  description: "Existing calendar details",
  startDate: "2026-09-03",
  endDateExclusive: "2026-09-09",
  updated: "2026-08-31T20:00:00.000Z",
  status: "confirmed",
};

const input = {
  summary: "KRISTY Meeteetse Annual Labor Day Celebration 2026 - Meeteetse WY (Zone)",
  description: "App details",
  startDate: "2026-09-03",
  endDateExclusive: "2026-09-09",
};

describe("existing operational calendar event detection", () => {
  it("adopts one exact unlinked package event instead of creating a duplicate", () => {
    expect(findExactOperationalCalendarEvent([expected], input)).toEqual({
      kind: "matched",
      event: expected,
    });
  });

  it("does not treat different package rows as duplicates", () => {
    expect(findExactOperationalCalendarEvent([
      { ...expected, id: "pirates", summary: expected.summary.replace("(Zone)", "(Pirates)") },
    ], input)).toEqual({ kind: "none" });
  });

  it("flags multiple exact rows instead of creating a third copy", () => {
    const second = { ...expected, id: "existing-meeteetse-zone-2", etag: '"two"' };
    expect(findExactOperationalCalendarEvent([expected, second], input)).toEqual({
      kind: "ambiguous",
      events: [expected, second],
    });
  });
});
