import { describe, expect, it } from "vitest";

import { validatePaperNoteEventDate } from "./paper-note-event-date-validation";

describe("validatePaperNoteEventDate", () => {
  it("blocks a structured event date until an inferred page year is confirmed", () => {
    expect(validatePaperNoteEventDate({
      startsOn: "2026-06-22",
      endsOn: "2026-06-23",
      pageYearConfirmed: false,
    })).toEqual([expect.objectContaining({
      fieldPath: "event.pageYearConfirmed",
      severity: "blocking",
    })]);
  });

  it("does not block when there is no structured date or the year is confirmed", () => {
    expect(validatePaperNoteEventDate({ startsOn: null, endsOn: null, pageYearConfirmed: false })).toEqual([]);
    expect(validatePaperNoteEventDate({ startsOn: "2026-06-22", endsOn: null, pageYearConfirmed: true })).toEqual([]);
  });
});
