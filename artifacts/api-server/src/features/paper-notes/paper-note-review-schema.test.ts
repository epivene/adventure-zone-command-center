import { describe, expect, it } from "vitest";

import { validatePaperNoteCurrentFollowUp } from "./paper-note-follow-up-validation";
import { validatePaperNotePrimaryPhones } from "./paper-note-primary-phone-validation";
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

const structuredPhone = (key: string) => ({
  key,
  number: "208-555-0142",
  extension: null,
  type: "office" as const,
  label: null,
  instructions: null,
  status: "active" as const,
  primary: true,
  crossedOut: false,
  importAsStructuredValue: true,
});

describe("paper-note review validation", () => {
  it("accepts a reviewed new profile without converting the old reminder to a task", () => {
    const input = review();
    expect(paperNoteReviewPayloadSchema.safeParse(input).success).toBe(true);
    expect(validatePaperNoteReview(input).filter((issue) => issue.severity === "blocking")).toEqual([]);
    expect(input.currentFollowUp.enabled).toBe(false);
    expect(input.oldReminder).toBe("Call Monday");
  });

  it("allows a completely sparse new profile with no contact", () => {
    const input = review({
      event: {
        name: "",
        city: "",
        region: "",
        venue: "",
        eventDateText: "",
        startsOn: null,
        endsOn: null,
        pageYearConfirmed: false,
      },
      activity: { occurredOn: null, method: "unknown", outcome: "", summary: "" },
      contacts: [],
      organizationPhones: [],
      oldReminder: "",
      starredOnPaper: false,
      generalNotes: [],
    });
    expect(validatePaperNoteReview(input).filter((issue) => issue.severity === "blocking")).toEqual([]);
  });

  it("allows an extracted contact to be kept history-only without creating a contact", () => {
    const input = review({
      contacts: [{
        key: "contact-0",
        mode: "note_only",
        selectedContactId: null,
        name: "",
        role: null,
        email: null,
        primary: false,
        phones: [],
      }],
    });
    expect(validatePaperNoteReview(input).filter((issue) => issue.severity === "blocking")).toEqual([]);
  });

  it("keeps inferred event years reviewable but not mandatory", () => {
    const input = review({ event: { ...review().event, eventDateText: "June 22", startsOn: "2026-06-22", pageYearConfirmed: false } });
    expect(validatePaperNoteReview(input).some((issue) => issue.fieldPath === "event.pageYearConfirmed" && issue.severity === "blocking")).toBe(false);
  });

  it("blocks a current follow-up without a new absolute date", () => {
    const input = review({ currentFollowUp: { enabled: true, kind: "call", dueOn: null, contactKey: null } });
    expect(validatePaperNoteReview(input)).toContainEqual(expect.objectContaining({ fieldPath: "currentFollowUp.dueOn", severity: "blocking" }));
  });

  it("blocks a current follow-up that points to a history-only or missing contact", () => {
    const baseContact = {
      key: "contact-0",
      mode: "note_only" as const,
      selectedContactId: null,
      name: "Tina",
      role: null,
      email: null,
      primary: true,
      phones: [],
    };
    const input = review({
      contacts: [baseContact],
      currentFollowUp: { enabled: true, kind: "call", dueOn: "2026-09-01", contactKey: "contact-0" },
    });
    expect(validatePaperNoteCurrentFollowUp(input)).toContainEqual(expect.objectContaining({
      fieldPath: "currentFollowUp.contactKey",
      severity: "blocking",
    }));

    const missing = review({
      contacts: [{ ...baseContact, mode: "new_contact" as const }],
      currentFollowUp: { enabled: true, kind: "call", dueOn: "2026-09-01", contactKey: "does-not-exist" },
    });
    expect(validatePaperNoteCurrentFollowUp(missing)).toContainEqual(expect.objectContaining({
      fieldPath: "currentFollowUp.contactKey",
      severity: "blocking",
    }));
  });

  it("blocks invalid structured phone numbers while allowing note-only crossed-out phones", () => {
    const invalid = review({
      organizationPhones: [{
        key: "office", number: "208-55?", extension: "3115", type: "office", label: "fair office",
        instructions: null, status: "questionable", primary: false, crossedOut: false, importAsStructuredValue: true,
      }],
    });
    expect(validatePaperNoteReview(invalid)).toContainEqual(expect.objectContaining({ fieldPath: "organizationPhones.0.number", severity: "blocking" }));

    const noteOnly = review({ organizationPhones: [{ ...invalid.organizationPhones[0]!, crossedOut: true, importAsStructuredValue: false }] });
    expect(validatePaperNoteReview(noteOnly).some((issue) => issue.fieldPath === "organizationPhones.0.number" && issue.severity === "blocking")).toBe(false);
  });

  it("blocks more than one primary organization phone", () => {
    const input = review({
      organizationPhones: [
        structuredPhone("office-1"),
        { ...structuredPhone("office-2"), number: "208-555-0143" },
      ],
    });
    expect(validatePaperNotePrimaryPhones(input)).toContainEqual(expect.objectContaining({
      fieldPath: "organizationPhones",
      severity: "blocking",
    }));
  });

  it("blocks more than one primary phone for a new contact", () => {
    const input = review({
      contacts: [{
        key: "contact-0",
        mode: "new_contact",
        selectedContactId: null,
        name: "Tina",
        role: null,
        email: null,
        primary: true,
        phones: [
          structuredPhone("phone-1"),
          { ...structuredPhone("phone-2"), number: "208-555-0143" },
        ],
      }],
    });
    expect(validatePaperNotePrimaryPhones(input)).toContainEqual(expect.objectContaining({
      fieldPath: "contacts.0.phones",
      severity: "blocking",
    }));
  });

  it("does not require paper-vs-saved contact conflict decisions just to keep the profile linked", () => {
    const input = review({
      destination: { mode: "existing_profile", organizationId: "10000000-0000-4000-8000-000000000001", organizationLocationId: null },
      contacts: [{
        key: "contact-0", mode: "existing_contact", selectedContactId: "50000000-0000-4000-8000-000000000001",
        name: "Tina", role: null, email: "tina@example.test", primary: true,
        phones: [{ ...structuredPhone("phone-0"), extension: "3115", importAsStructuredValue: false }],
      }],
    });
    const issues = validatePaperNoteReview(input);
    expect(issues.some((issue) => issue.fieldPath === "contacts.0.name" && issue.severity === "blocking")).toBe(false);
    expect(issues.some((issue) => issue.fieldPath === "contacts.0.email" && issue.severity === "blocking")).toBe(false);
  });
});
