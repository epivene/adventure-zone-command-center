import { describe, expect, it } from "vitest";

import {
  paperNoteReviewPayloadSchema,
  validatePaperNoteReview,
  type PaperNoteReviewPayload,
} from "./paper-note-review-schema";

function review(overrides: Partial<PaperNoteReviewPayload> = {}): PaperNoteReviewPayload {
  return {
    event: {
      name: "Emmett Cherry Festival",
      city: "Emmett",
      region: "ID",
      venue: "",
      eventDateText: "",
      startsOn: null,
      endsOn: null,
      pageYearConfirmed: false,
    },
    activity: {
      occurredOn: "2026-04-21",
      method: "call",
      outcome: "No room this year",
      summary: "Spoke with Tina; requested information by email.",
    },
    contacts: [],
    organizationPhones: [],
    oldReminder: "Call Monday",
    starredOnPaper: true,
    generalNotes: [],
    destination: { mode: "new_profile", eventFamilyId: null },
    conflicts: {},
    currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
    ...overrides,
  };
}

describe("paper-note review validation", () => {
  it("accepts a reviewed new profile without converting the old reminder to a task", () => {
    const input = review();
    expect(paperNoteReviewPayloadSchema.safeParse(input).success).toBe(true);
    expect(validatePaperNoteReview(input).filter((issue) => issue.severity === "blocking")).toEqual([]);
    expect(input.currentFollowUp.enabled).toBe(false);
    expect(input.oldReminder).toBe("Call Monday");
  });

  it("blocks a new profile without a name", () => {
    const input = review({
      event: { ...review().event, name: "" },
    });
    expect(validatePaperNoteReview(input)).toContainEqual(expect.objectContaining({
      fieldPath: "event.name",
      severity: "blocking",
    }));
  });

  it("blocks a current follow-up without a new absolute date", () => {
    const input = review({
      currentFollowUp: { enabled: true, kind: "call", dueOn: null, contactKey: null },
    });
    expect(validatePaperNoteReview(input)).toContainEqual(expect.objectContaining({
      fieldPath: "currentFollowUp.dueOn",
      severity: "blocking",
    }));
  });

  it("blocks invalid structured phone numbers while allowing note-only crossed-out phones", () => {
    const invalid = review({
      organizationPhones: [{
        key: "office",
        number: "208-55?",
        extension: "3115",
        type: "office",
        label: "fair office",
        instructions: null,
        status: "questionable",
        primary: false,
        crossedOut: false,
        importAsStructuredValue: true,
      }],
    });
    expect(validatePaperNoteReview(invalid)).toContainEqual(expect.objectContaining({
      fieldPath: "organizationPhones.0.number",
      severity: "blocking",
    }));

    const noteOnly = review({
      organizationPhones: [{
        ...invalid.organizationPhones[0]!,
        crossedOut: true,
        importAsStructuredValue: false,
      }],
    });
    expect(validatePaperNoteReview(noteOnly).some((issue) => issue.fieldPath === "organizationPhones.0.number" && issue.severity === "blocking")).toBe(false);
  });
});
