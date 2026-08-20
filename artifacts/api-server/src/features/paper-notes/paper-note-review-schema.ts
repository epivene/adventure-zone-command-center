import { z } from "zod/v4";

export type PaperNotePhoneStatus = "active" | "questionable" | "inactive";

export type PaperNoteReviewedPhone = {
  key: string;
  number: string;
  extension: string | null;
  type: "mobile" | "office" | "alternate" | "unknown";
  label: string | null;
  instructions: string | null;
  status: PaperNotePhoneStatus;
  primary: boolean;
  crossedOut: boolean;
  importAsStructuredValue: boolean;
};

export type PaperNoteReviewedContact = {
  key: string;
  mode: "existing_contact" | "new_contact" | "note_only";
  selectedContactId: string | null;
  name: string;
  role: string | null;
  email: string | null;
  primary: boolean;
  phones: PaperNoteReviewedPhone[];
};

export type PaperNoteNewLocationInput = {
  label: string;
  venueName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};

export type PaperNoteDestinationChoice =
  | {
      mode: "existing_profile";
      organizationId: string;
      organizationLocationId: string | null;
    }
  | {
      mode: "existing_profile_new_location";
      organizationId: string;
      newLocation: PaperNoteNewLocationInput;
    }
  | {
      mode: "new_profile";
      eventFamilyId: string | null;
    }
  | { mode: "skip" };

export type PaperNoteFieldDecision =
  | "keep_saved"
  | "replace_saved"
  | "ignore_paper_note_only"
  | "create_separate_location";

export type PaperNotePhoneDecision =
  | "keep_saved"
  | "same_phone_update_details"
  | "add_alternate"
  | "replace_primary"
  | "inactivate_saved_add_paper"
  | "add_questionable"
  | "ignore_paper"
  | "crossed_out_note_only";

export type PaperNoteConflictDecision =
  | {
      kind: "field";
      fieldPath: string;
      decision: PaperNoteFieldDecision;
      targetId: string | null;
    }
  | {
      kind: "phone";
      fieldPath: string;
      decision: PaperNotePhoneDecision;
      existingPhoneId: string | null;
    };

export type PaperNoteReviewPayload = {
  event: {
    name: string;
    city: string;
    region: string;
    venue: string;
    eventDateText: string;
    startsOn: string | null;
    endsOn: string | null;
    pageYearConfirmed: boolean;
  };
  activity: {
    occurredOn: string | null;
    method: "call" | "email" | "mail" | "text" | "unknown";
    outcome: string;
    summary: string;
  };
  contacts: PaperNoteReviewedContact[];
  organizationPhones: PaperNoteReviewedPhone[];
  oldReminder: string;
  starredOnPaper: boolean;
  generalNotes: string[];
  destination: PaperNoteDestinationChoice;
  conflicts: Record<string, PaperNoteConflictDecision>;
  currentFollowUp: {
    enabled: boolean;
    kind: string;
    dueOn: string | null;
    contactKey: string | null;
  };
};

export type PaperNoteReviewIssue = {
  fieldPath: string;
  message: string;
  severity: "warning" | "blocking";
};

const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable();
const dateValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const phoneType = z.enum(["mobile", "office", "alternate", "unknown"]);
const phoneStatus = z.enum(["active", "questionable", "inactive"]);

const reviewedPhoneSchema = z.object({
  key: z.string().min(1).max(120),
  number: z.string().max(80),
  extension: nullableTrimmed(32),
  type: phoneType,
  label: nullableTrimmed(120),
  instructions: nullableTrimmed(500),
  status: phoneStatus,
  primary: z.boolean(),
  crossedOut: z.boolean(),
  importAsStructuredValue: z.boolean(),
});

const reviewedContactSchema = z.object({
  key: z.string().min(1).max(120),
  mode: z.enum(["existing_contact", "new_contact", "note_only"]),
  selectedContactId: z.string().uuid().nullable(),
  name: z.string().max(300),
  role: nullableTrimmed(200),
  email: nullableTrimmed(320),
  primary: z.boolean(),
  phones: z.array(reviewedPhoneSchema).max(12),
});

const newLocationSchema = z.object({
  label: z.string().max(300),
  venueName: nullableTrimmed(300),
  address1: nullableTrimmed(300),
  address2: nullableTrimmed(300),
  city: nullableTrimmed(200),
  region: nullableTrimmed(80),
  postalCode: nullableTrimmed(40),
});

const destinationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing_profile"),
    organizationId: z.string().uuid(),
    organizationLocationId: z.string().uuid().nullable(),
  }),
  z.object({
    mode: z.literal("existing_profile_new_location"),
    organizationId: z.string().uuid(),
    newLocation: newLocationSchema,
  }),
  z.object({
    mode: z.literal("new_profile"),
    eventFamilyId: z.string().uuid().nullable(),
  }),
  z.object({ mode: z.literal("skip") }),
]);

const fieldConflictSchema = z.object({
  kind: z.literal("field"),
  fieldPath: z.string().min(1).max(300),
  decision: z.enum([
    "keep_saved",
    "replace_saved",
    "ignore_paper_note_only",
    "create_separate_location",
  ]),
  targetId: z.string().uuid().nullable(),
});

const phoneConflictSchema = z.object({
  kind: z.literal("phone"),
  fieldPath: z.string().min(1).max(300),
  decision: z.enum([
    "keep_saved",
    "same_phone_update_details",
    "add_alternate",
    "replace_primary",
    "inactivate_saved_add_paper",
    "add_questionable",
    "ignore_paper",
    "crossed_out_note_only",
  ]),
  existingPhoneId: z.string().uuid().nullable(),
});

export const paperNoteReviewPayloadSchema: z.ZodType<PaperNoteReviewPayload> = z.object({
  event: z.object({
    name: z.string().max(300),
    city: z.string().max(200),
    region: z.string().max(80),
    venue: z.string().max(300),
    eventDateText: z.string().max(300),
    startsOn: dateValue,
    endsOn: dateValue,
    pageYearConfirmed: z.boolean(),
  }),
  activity: z.object({
    occurredOn: dateValue,
    method: z.enum(["call", "email", "mail", "text", "unknown"]),
    outcome: z.string().max(1000),
    summary: z.string().max(4000),
  }),
  contacts: z.array(reviewedContactSchema).max(20),
  organizationPhones: z.array(reviewedPhoneSchema).max(20),
  oldReminder: z.string().max(2000),
  starredOnPaper: z.boolean(),
  generalNotes: z.array(z.string().max(2000)).max(40),
  destination: destinationSchema,
  conflicts: z.record(z.string(), z.union([fieldConflictSchema, phoneConflictSchema])),
  currentFollowUp: z.object({
    enabled: z.boolean(),
    kind: z.string().max(120),
    dueOn: dateValue,
    contactKey: z.string().max(120).nullable(),
  }),
});

function validNorthAmericanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

function validExtension(value: string | null) {
  return value === null || value === "" || /^\d{1,10}$/.test(value);
}

function validEmail(value: string | null) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validatePaperNoteReview(review: PaperNoteReviewPayload): PaperNoteReviewIssue[] {
  const issues: PaperNoteReviewIssue[] = [];
  const block = (fieldPath: string, message: string) => issues.push({ fieldPath, message, severity: "blocking" });
  const warn = (fieldPath: string, message: string) => issues.push({ fieldPath, message, severity: "warning" });

  if (review.destination.mode === "new_profile" && !review.event.name.trim()) {
    block("event.name", "Enter an event/profile name before creating a new profile.");
  }
  if (review.event.region.trim() && !/^[A-Za-z]{2}$/.test(review.event.region.trim())) {
    warn("event.region", "Check the state/region abbreviation from the paper.");
  }
  if (review.destination.mode === "existing_profile_new_location" && !review.destination.newLocation.label.trim()) {
    block("destination.newLocation.label", "Enter a location label before creating a new location.");
  }
  if (review.currentFollowUp.enabled && !review.currentFollowUp.dueOn) {
    block(
      "currentFollowUp.dueOn",
      "Choose a new current follow-up date. Old paper reminder wording is never reused as a due date.",
    );
  }

  review.contacts.forEach((contact, contactIndex) => {
    if (contact.mode === "new_contact" && !contact.name.trim()) {
      block(`contacts.${contactIndex}.name`, "Enter the contact name before creating this contact.");
    }
    if (contact.mode === "existing_contact" && !contact.selectedContactId) {
      block(`contacts.${contactIndex}.selectedContactId`, "Choose the existing contact to link.");
    }
    if (!validEmail(contact.email)) {
      block(`contacts.${contactIndex}.email`, "Check the email address before importing it.");
    }
    contact.phones.forEach((phone, phoneIndex) => {
      validatePhone(phone, `contacts.${contactIndex}.phones.${phoneIndex}`, block, warn);
    });
  });

  review.organizationPhones.forEach((phone, phoneIndex) => {
    validatePhone(phone, `organizationPhones.${phoneIndex}`, block, warn);
  });

  return issues;
}

function validatePhone(
  phone: PaperNoteReviewedPhone,
  path: string,
  block: (fieldPath: string, message: string) => void,
  warn: (fieldPath: string, message: string) => void,
) {
  if (!phone.importAsStructuredValue) {
    if (phone.crossedOut) warn(path, "Crossed-out phone is staying in the historical note only.");
    return;
  }
  if (!validNorthAmericanPhone(phone.number)) {
    block(`${path}.number`, "Check the phone number before importing it as a structured phone.");
  }
  if (!validExtension(phone.extension)) {
    block(`${path}.extension`, "Check the phone extension before importing it.");
  }
  if (phone.crossedOut) {
    warn(path, "This phone was crossed out on the original paper. Confirm the explicit phone decision before import.");
  }
}
