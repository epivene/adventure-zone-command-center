import { describe, expect, it } from "vitest";

import { nextDenverBusinessDayAtNine } from "./next-business-day";

describe("nextDenverBusinessDayAtNine", () => {
  it.each([
    ["Thursday", "2026-09-03T18:00:00.000Z", "2026-09-04T15:00:00.000Z"],
    ["Friday", "2026-09-04T18:00:00.000Z", "2026-09-07T15:00:00.000Z"],
    ["Saturday", "2026-09-05T18:00:00.000Z", "2026-09-07T15:00:00.000Z"],
    ["before spring DST", "2026-03-06T18:00:00.000Z", "2026-03-09T15:00:00.000Z"],
    ["before fall DST", "2026-10-30T18:00:00.000Z", "2026-11-02T16:00:00.000Z"],
  ])("maps %s to the next Denver business day at 09:00", (_label, from, want) => {
    const result = nextDenverBusinessDayAtNine(new Date(from));
    expect(result.toISOString()).toBe(want);
    expect(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Denver",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(result),
    ).toBe("09:00");
  });
});
