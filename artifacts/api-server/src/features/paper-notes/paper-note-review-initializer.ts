import type { PaperNoteExtraction } from "./paper-note-extraction-schema";
import type {
  PaperNoteDestinationChoice,
  PaperNoteReviewedContact,
  PaperNoteReviewedPhone,
  PaperNoteReviewPayload,
} from "./paper-note-review-schema";

export type PaperNoteReviewDraft = Omit<PaperNoteReviewPayload, "destination"> & {
  destination: PaperNoteDestinationChoice | null;
};

function reviewedPhone(
  phone: PaperNoteExtraction["organizationPhones"][number],
  key: string,
): PaperNoteReviewedPhone {
  return {
    key,
    number: phone.number ?? "",
    extension: phone.extension,
    type: phone.type,
    label: phone.label,
    instructions: phone.instructions,
    status: phone.crossedOut ? "questionable" : "active",
    primary: false,
    crossedOut: phone.crossedOut,
    importAsStructuredValue: Boolean(phone.number) && !phone.crossedOut,
  };
}

function reviewedContact(
  contact: PaperNoteExtraction["contacts"][number],
  index: number,
): PaperNoteReviewedContact {
  return {
    key: `contact-${index}`,
    mode: "new_contact",
    selectedContactId: null,
    name: contact.name ?? "",
    role: contact.role,
    email: contact.email,
    primary: index === 0,
    phones: contact.phones.map((phone, phoneIndex) =>
      reviewedPhone(phone, `contact-${index}-phone-${phoneIndex}`)),
  };
}

export function initializePaperNoteReview(
  extraction: PaperNoteExtraction,
): PaperNoteReviewDraft {
  const eventDate = extraction.eventDates[0] ?? null;
  return {
    event: {
      name: extraction.event.name ?? "",
      city: extraction.event.city ?? "",
      region: extraction.event.region ?? "",
      venue: extraction.event.venue ?? "",
      eventDateText: eventDate?.rawText ?? "",
      startsOn: eventDate?.startsOn ?? null,
      endsOn: eventDate?.endsOn ?? null,
      pageYearConfirmed: eventDate ? !eventDate.derivedFromPageYear : false,
    },
    activity: {
      occurredOn: extraction.activity.occurredOn,
      method: extraction.activity.method,
      outcome: extraction.activity.outcome ?? "",
      summary: extraction.activity.summary ?? "",
    },
    contacts: extraction.contacts.map(reviewedContact),
    organizationPhones: extraction.organizationPhones.map((phone, index) =>
      reviewedPhone(phone, `organization-phone-${index}`)),
    oldReminder: extraction.oldReminder ?? "",
    starredOnPaper: extraction.starredOnPaper,
    generalNotes: [...extraction.generalNotes],
    destination: null,
    conflicts: {},
    currentFollowUp: {
      enabled: false,
      kind: "call",
      dueOn: null,
      contactKey: null,
    },
  };
}
