import { describe, expect, it } from "vitest";

import { applyPaperNotePageLastContactDate } from "./paper-note-extraction-worker";
import type { PaperNoteExtraction } from "./paper-note-extraction-schema";

const base: PaperNoteExtraction = {
  source: "provider",
  transcription: "Example Fair",
  sourceRegion: null,
  mayContinue: false,
  event: { name: "Example Fair", city: null, region: null, venue: null },
  eventDates: [{ rawText: "July 4", startsOn: null, endsOn: null, derivedFromPageYear: false }],
  activity: { rawDateText: null, occurredOn: null, dateSource: "unknown", method: "unknown", outcome: null, summary: null },
  contacts: [],
  organizationPhones: [],
  oldReminder: null,
  starredOnPaper: false,
  generalNotes: [],
  warnings: [],
};

describe("applyPaperNotePageLastContactDate", () => {
  it("uses the paper-top date as last contacted when the entry has no specific contact date", () => {
    const result = applyPaperNotePageLastContactDate(base, "2025-07-14");
    expect(result.activity.occurredOn).toBe("2025-07-14");
    expect(result.activity.dateSource).toBe("page_heading");
    expect(result.eventDates).toEqual(base.eventDates);
  });

  it("keeps an explicit entry-specific contact date instead", () => {
    const result = applyPaperNotePageLastContactDate({
      ...base,
      activity: { ...base.activity, occurredOn: "2025-07-16", rawDateText: "7/16", dateSource: "entry" },
    }, "2025-07-14");
    expect(result.activity.occurredOn).toBe("2025-07-16");
    expect(result.activity.dateSource).toBe("entry");
  });
});
