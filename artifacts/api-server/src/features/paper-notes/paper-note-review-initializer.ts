import type { PaperNoteExtraction } from "./paper-note-extraction-schema";
import {
  paperNoteSuggestsPotentialBooking,
  POTENTIAL_BOOKING_NEXT_YEAR_NOTE,
} from "./paper-note-future-action-reminder";
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

function hasMeaningfulContactValue(contact: PaperNoteExtraction["contacts"][number]) {
  return Boolean(
    contact.name?.trim()
    || contact.role?.trim()
    || contact.email?.trim()
    || contact.phones.some((phone) =>
      phone.number?.trim()
      || phone.extension?.trim()
      || phone.label?.trim()
      || phone.instructions?.trim()),
  );
}

function reviewedContact(
  contact: PaperNoteExtraction["contacts"][number],
  index: number,
): PaperNoteReviewedContact {
  const hasPersonIdentity = Boolean(contact.name?.trim() || contact.email?.trim() || contact.role?.trim());
  return {
    key: `contact-${index}`,
    mode: hasPersonIdentity ? "new_contact" : "note_only",
    selectedContactId: null,
    name: contact.name ?? "",
    role: contact.role,
    email: contact.email,
    primary: hasPersonIdentity && index === 0,
    phones: contact.phones.map((phone, phoneIndex) =>
      reviewedPhone(phone, `contact-${index}-phone-${phoneIndex}`)),
  };
}

export function initializePaperNoteReview(
  extraction: PaperNoteExtraction,
): PaperNoteReviewDraft {
  const eventDate = extraction.eventDates[0] ?? null;
  const contacts = extraction.contacts
    .filter(hasMeaningfulContactValue)
    .map(reviewedContact);
  const generalNotes = [...extraction.generalNotes];
  if (paperNoteSuggestsPotentialBooking({
    transcription: extraction.transcription,
    oldReminder: extraction.oldReminder,
    outcome: extraction.activity.outcome,
    summary: extraction.activity.summary,
    generalNotes,
  }) && !generalNotes.some((note) => note.trim() === POTENTIAL_BOOKING_NEXT_YEAR_NOTE)) {
    generalNotes.push(POTENTIAL_BOOKING_NEXT_YEAR_NOTE);
  }

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
    contacts,
    organizationPhones: extraction.organizationPhones.map((phone, index) =>
      reviewedPhone(phone, `organization-phone-${index}`)),
    oldReminder: extraction.oldReminder ?? "",
    starredOnPaper: extraction.starredOnPaper,
    generalNotes,
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
