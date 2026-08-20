import { describe, expect, it } from "vitest";

import { composePaperNoteHistory } from "./paper-note-note-composer";
import type { PaperNoteReviewPayload } from "./paper-note-review-schema";

function review(starredOnPaper = true): PaperNoteReviewPayload {
  return {
    event: {
      name: "Emmett Cherry Festival",
      city: "Emmett",
      region: "ID",
      venue: "",
      eventDateText: "June 22",
      startsOn: "2026-06-22",
      endsOn: null,
      pageYearConfirmed: true,
    },
    activity: {
      occurredOn: "2026-04-21",
      method: "call",
      outcome: "No room this year",
      summary: "Spoke with Tina; requested info by email.",
    },
    contacts: [],
    organizationPhones: [],
    oldReminder: "Call Monday",
    starredOnPaper,
    generalNotes: [],
    destination: { mode: "new_profile", eventFamilyId: null },
    conflicts: {},
    currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
  };
}

describe("composePaperNoteHistory", () => {
  it("keeps an old reminder historical and records a star only as note text", () => {
    const body = composePaperNoteHistory({
      review: review(true),
      originalTranscription: "Emmett Cherry Festival — Tina — call Monday ★",
    });

    expect(body).toContain("Imported from paper notes");
    expect(body).toContain("Original reminder: Call Monday. This was a historical reminder and was not added as a current task.");
    expect(body).toContain("Starred on original paper.");
    expect(body).not.toContain("Favorite");
    expect(body).toContain("Original transcription: Emmett Cherry Festival — Tina — call Monday ★");
  });

  it("does not add star wording when the paper was not starred", () => {
    expect(composePaperNoteHistory({
      review: review(false),
      originalTranscription: "Emmett Cherry Festival",
    })).not.toContain("Starred on original paper.");
  });
});
