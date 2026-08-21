import { describe, expect, it } from "vitest";

import { validatePaperNoteEventDate } from "./paper-note-event-date-validation";

describe("validatePaperNoteEventDate", () => {
  it("warns but does not block when a structured event date uses an inferred page year", () => {
    expect(validatePaperNoteEventDate({
      startsOn: "2026-06-22",
      endsOn: "2026-06-23",
      pageYearConfirmed: false,
    })).toEqual([expect.objectContaining({
      fieldPath: "event.pageYearConfirmed",
      severity: "warning",
    })]);
  });

  it("does not warn when there is no structured date or the year is confirmed", () => {
    expect(validatePaperNoteEventDate({ startsOn: null, endsOn: null, pageYearConfirmed: false })).toEqual([]);
    expect(validatePaperNoteEventDate({ startsOn: "2026-06-22", endsOn: null, pageYearConfirmed: true })).toEqual([]);
  });
});
