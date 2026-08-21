import { describe, expect, it } from "vitest";

import { hydratePaperNoteReview } from "./paper-note-review-repository";

const extraction = {
  event: { name: "4th of July Island Park", city: "Island Park", region: "ID", venue: null },
  eventDates: [],
  activity: { occurredOn: null, method: "call", outcome: null, summary: null },
  contacts: [],
  organizationPhones: [],
  oldReminder: null,
  starredOnPaper: false,
  generalNotes: [],
} as any;

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
});
