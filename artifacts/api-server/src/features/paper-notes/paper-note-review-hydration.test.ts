import { describe, expect, it } from "vitest";

import { hydratePaperNoteReview } from "./paper-note-review-repository";

const extraction = {
  transcription: "4th of July Island Park",
  event: { name: "4th of July Island Park", city: "Island Park", region: "ID", venue: null },
  eventDates: [],
  activity: { occurredOn: null, method: "call", outcome: null, summary: null },
  contacts: [],
  organizationPhones: [],
  oldReminder: null,
  starredOnPaper: false,
  generalNotes: [],
} as any;

function savedReview(activity = { occurredOn: null, method: "call", outcome: "", summary: "" }) {
  return {
    event: { name: "4th of July Island Park", city: "Island Park", region: "ID", venue: "City Park", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
    activity,
    contacts: [],
    organizationPhones: [],
    oldReminder: "",
    starredOnPaper: false,
    generalNotes: [],
    destination: { mode: "existing_profile", organizationId: "10000000-0000-4000-8000-000000000001", organizationLocationId: null },
    conflicts: {},
    currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
  };
}

describe("hydratePaperNoteReview", () => {
  it("fills newer review fields without losing saved destination or edits", () => {
    const saved = {
      event: { name: "4th of July Island Park", city: "Island Park", region: "ID", venue: "City Park", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
      activity: { occurredOn: null, method: "call", outcome: "called", summary: "saved note" },
      contacts: [],
      destination: { mode: "existing_profile", organizationId: "10000000-0000-4000-8000-000000000001", organizationLocationId: null },
    };

    const review = hydratePaperNoteReview(extraction, saved);

    expect(review.destination).toEqual(saved.destination);
    expect(review.event.venue).toBe("City Park");
    expect(review.activity.summary).toBe("saved note");
    expect(review.organizationPhones).toEqual([]);
    expect(review.generalNotes).toEqual([]);
    expect(review.conflicts).toEqual({});
    expect(review.currentFollowUp).toEqual({ enabled: false, kind: "call", dueOn: null, contactKey: null });
  });

  it("recovers a clear future-action reminder from transcription without re-reading the photo", () => {
    const futureActionExtraction = {
      ...extraction,
      transcription: "4th of July - Lakeside Lodge and resort @ Hotmail.Com, Island Park ID - Send email.",
      activity: { occurredOn: null, method: "email", outcome: null, summary: null },
      oldReminder: null,
    } as any;

    const review = hydratePaperNoteReview(
      futureActionExtraction,
      savedReview({ occurredOn: null, method: "email", outcome: "", summary: "" }),
    );

    expect(review.oldReminder).toBe("Send email");
    expect(review.activity.method).toBe("call");
  });

  it("does not turn wording for a completed email into a future reminder", () => {
    const completedActionExtraction = {
      ...extraction,
      transcription: "4th of July - Emailed Lakeside Lodge. No response.",
      activity: { occurredOn: null, method: "email", outcome: "No response", summary: null },
      oldReminder: null,
    } as any;

    const review = hydratePaperNoteReview(
      completedActionExtraction,
      savedReview({ occurredOn: null, method: "email", outcome: "No response", summary: "" }),
    );

    expect(review.oldReminder).toBe("");
    expect(review.activity.method).toBe("email");
  });
});
