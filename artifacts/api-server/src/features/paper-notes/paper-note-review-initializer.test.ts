import { describe, expect, it } from "vitest";

import { initializePaperNoteReview } from "./paper-note-review-initializer";
import type { PaperNoteExtraction } from "./paper-note-extraction-schema";

const extraction: PaperNoteExtraction = {
  source: "provider",
  transcription: "Emmett Cherry Festival — Tina — 208-555-0142 ext 3115 — call Monday ★",
  sourceRegion: null,
  mayContinue: false,
  event: { name: "Emmett Cherry Festival", city: "Emmett", region: "ID", venue: null },
  eventDates: [],
  activity: {
    rawDateText: "Apr 21",
    occurredOn: "2026-04-21",
    dateSource: "page_heading",
    method: "call",
    outcome: "No room this year",
    summary: "Spoke with Tina; requested info by email.",
  },
  contacts: [{
    name: "Tina",
    role: null,
    email: null,
    phones: [{
      number: "208-555-0142",
      extension: "3115",
      type: "office",
      label: "fair office",
      instructions: null,
      crossedOut: false,
    }],
  }],
  organizationPhones: [],
  oldReminder: "Call Monday",
  starredOnPaper: true,
  generalNotes: [],
  warnings: [],
};

describe("initializePaperNoteReview", () => {
  it("copies readable paper values but leaves the CRM destination unresolved", () => {
    const review = initializePaperNoteReview(extraction);
    expect(review.event.name).toBe("Emmett Cherry Festival");
    expect(review.contacts[0]?.phones[0]).toMatchObject({
      number: "208-555-0142",
      extension: "3115",
    });
    expect(review.oldReminder).toBe("Call Monday");
    expect(review.starredOnPaper).toBe(true);
    expect(review.destination).toBeNull();
    expect(review.currentFollowUp.enabled).toBe(false);
  });
});
