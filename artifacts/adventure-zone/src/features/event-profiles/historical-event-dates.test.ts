import { describe, expect, it } from "vitest";

import { extractHistoricalEventDates } from "./historical-event-dates";

describe("extractHistoricalEventDates", () => {
  it("extracts clearly labeled ACT event dates and preserves the source note", () => {
    const notes = [
      "EVENT DATES:\nJuly 1, 2023.",
      "Called contact on March 8, 2024 and left a message.",
    ];

    expect(extractHistoricalEventDates(notes)).toEqual([
      {
        dateText: "July 1, 2023.",
        sourceNote: "EVENT DATES:\nJuly 1, 2023.",
      },
    ]);
  });

  it("accepts event date and dates labels but ignores unlabeled dates", () => {
    expect(extractHistoricalEventDates([
      "Event Date: 7/4/2022",
      "DATES: June 12-15, 2024",
      "Spoke with Amy 8/1/2025",
    ])).toEqual([
      { dateText: "7/4/2022", sourceNote: "Event Date: 7/4/2022" },
      { dateText: "June 12-15, 2024", sourceNote: "DATES: June 12-15, 2024" },
    ]);
  });

  it("deduplicates the same labeled historical date", () => {
    expect(extractHistoricalEventDates([
      "EVENT DATES: July 1, 2023",
      "Event Dates:   July 1, 2023",
    ])).toHaveLength(1);
  });
});
