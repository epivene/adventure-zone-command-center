import { describe, expect, it } from "vitest";

import { initializePaperNoteReview } from "./paper-note-review-initializer";
import type { PaperNoteExtraction } from "./paper-note-extraction-schema";

function extraction(overrides: Partial<PaperNoteExtraction> = {}): PaperNoteExtraction {
  return {
    source: "provider",
    transcription: "Example Fair - Send email.",
    sourceRegion: null,
    mayContinue: false,
    event: { name: "Example Fair", city: "Boise", region: "ID", venue: null },
    eventDates: [],
    activity: {
      rawDateText: null,
      occurredOn: "2025-07-14",
      dateSource: "page_heading",
      method: "unknown",
      outcome: null,
      summary: null,
    },
    contacts: [],
    organizationPhones: [],
    oldReminder: "Send email",
    starredOnPaper: false,
    generalNotes: [],
    warnings: [],
    ...overrides,
  };
}

describe("potential booking next-year note", () => {
  it("adds a clean next-year note for a send-email instruction", () => {
    const review = initializePaperNoteReview(extraction());
    expect(review.generalNotes).toContain("Potential booking — reach out next year.");
  });

  it("adds the note for other clear possible-booking wording", () => {
    const review = initializePaperNoteReview(extraction({
      transcription: "Example Fair - interested, maybe next year.",
      oldReminder: null,
    }));
    expect(review.generalNotes).toContain("Potential booking — reach out next year.");
  });

  it("does not add the note for a completed email with no possible-booking signal", () => {
    const review = initializePaperNoteReview(extraction({
      transcription: "Example Fair - Emailed July 14 - no response.",
      oldReminder: null,
      activity: {
        rawDateText: "July 14",
        occurredOn: "2025-07-14",
        dateSource: "entry",
        method: "email",
        outcome: "No response",
        summary: "Emailed the event.",
      },
    }));
    expect(review.generalNotes).not.toContain("Potential booking — reach out next year.");
  });
});
