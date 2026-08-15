import { describe, expect, it } from "vitest";
import { buildMonthSpanSegments } from "./month-spans";

const days = Array.from({ length: 42 }, (_, index) =>
  new Date(Date.UTC(2026, 7, 2 + index)),
);

describe("buildMonthSpanSegments", () => {
  it("spans August 18 through August 21 inclusively", () => {
    expect(
      buildMonthSpanSegments(
        [{ id: "fair", startsAt: new Date("2026-08-18T12:00:00Z"), endsAt: new Date("2026-08-21T23:00:00Z") }],
        days,
      ),
    ).toEqual([
      { eventId: "fair", weekIndex: 2, startColumn: 2, endColumn: 5, startsHere: true, endsHere: true },
    ]);
  });

  it("continues cleanly across a week boundary", () => {
    expect(
      buildMonthSpanSegments(
        [{ id: "cross", startsAt: new Date("2026-08-21T12:00:00Z"), endsAt: new Date("2026-08-25T12:00:00Z") }],
        days,
      ),
    ).toEqual([
      { eventId: "cross", weekIndex: 2, startColumn: 5, endColumn: 6, startsHere: true, endsHere: false },
      { eventId: "cross", weekIndex: 3, startColumn: 0, endColumn: 2, startsHere: false, endsHere: true },
    ]);
  });

  it("clips spans that start before the visible grid", () => {
    const result = buildMonthSpanSegments(
      [{ id: "long", startsAt: new Date("2026-07-20T12:00:00Z"), endsAt: new Date("2026-08-05T12:00:00Z") }],
      days,
    );
    expect(result[0]).toMatchObject({ eventId: "long", weekIndex: 0, startColumn: 0, startsHere: false });
  });
});
