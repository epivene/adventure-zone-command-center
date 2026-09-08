import { z } from "zod";

import { bookingEditInputSchema } from "@/features/bookings/booking-input";
import { bookingStatusValues, probabilityValues, type BookingStatus } from "@/features/bookings/booking-types";
import type { BookingEditInput } from "@/features/bookings/booking-input";
import type { CompleteCallInput } from "@/features/calls/call-types";
import {
  contactFormInputSchema,
  nullableContactEmailSchema,
} from "@/features/contacts/contact-input";
import type { ContactFields } from "@/features/contacts/contact-types";

const callDispositionSchema = z.enum([
  "no_answer",
  "left_voicemail",
  "follow_up_needed",
  "interested",
  "proposal_contract_sent",
  "booked",
  "declined",
  "move_to_last_resort",
  "spoke_with_contact",
  "wrong_number",
  "do_not_call",
  "email_requested",
]);

const nullableText = z.union([z.string(), z.null()]).transform((value) => value?.trim() || null);
const nullableEmail = nullableContactEmailSchema;
const transportDate = z.union([
  z.date(),
  z.string().datetime({ offset: true }).transform((value) => new Date(value)),
]);

const approvedContactUpdatesSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  jobTitle: nullableText.optional(),
  email: nullableEmail.optional(),
  phone: nullableText.optional(),
  address1: nullableText.optional(),
  address2: nullableText.optional(),
  city: nullableText.optional(),
  region: nullableText.optional(),
  postalCode: nullableText.optional(),
}).strict();

const approvedBookingUpdatesSchema = z.object({
  name: z.string().trim().min(1).optional(),
  venueName: nullableText.optional(),
  address1: nullableText.optional(),
  city: z.string().trim().min(1).optional(),
  region: z.string().trim().min(2).transform((value) => value.toUpperCase()).optional(),
  postalCode: nullableText.optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  startsAt: transportDate.nullable().optional(),
  endsAt: transportDate.nullable().optional(),
  status: z.enum(bookingStatusValues).optional(),
  probability: z.enum(probabilityValues).optional(),
  travelLegId: z.string().uuid().nullable().optional(),
  notes: nullableText.optional(),
}).strict();

export const completeCallInputSchema = z.object({
  requestKey: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  bookingId: z.string().uuid().nullable(),
  followUpId: z.string().uuid().nullable(),
  note: z.string().trim(),
  disposition: callDispositionSchema,
  resultingBookingStatus: z.enum(bookingStatusValues).nullable(),
  startedAt: transportDate,
  endedAt: transportDate,
  nextAction: z.object({
    kind: z.string().trim().min(1, "Choose the next action"),
    dueAt: transportDate,
  }).nullable(),
  lastResortReason: z
    .union([z.string().trim().max(2_000), z.null()])
    .transform((value) => value || null),
  lastResortConfirmed: z.boolean(),
  approvedContactUpdates: approvedContactUpdatesSchema.nullable(),
  approvedBookingUpdates: approvedBookingUpdatesSchema.nullable(),
  direction: z.enum(["incoming", "outgoing"]),
  method: z.enum(["standard_call", "office_call", "individual_voicemail", "mobile_log", "browser_voip"]),
  phoneId: z.string().uuid().nullable(),
  scriptKind: z.enum(["first_outreach", "follow_up", "contract_follow_up", "incoming_inquiry"]),
  doNotCallConfirmed: z.boolean(),
  doNotCallReason: z.union([z.string().trim().min(1), z.null()]),
  doNotCallPhoneId: z.string().uuid().nullable(),
  entryMode: z.enum(["desktop", "mobile"]),
}).superRefine((value, context) => {
  if (value.endedAt.getTime() < value.startedAt.getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endedAt"],
      message: "Call end must be after the start.",
    });
  }
  if (value.disposition === "move_to_last_resort" && !value.lastResortReason) {
    context.addIssue({
      code: "custom",
      path: ["lastResortReason"],
      message: "Add a Last Resort reason",
    });
  }
  if (
    value.disposition === "move_to_last_resort" &&
    !value.lastResortConfirmed
  ) {
    context.addIssue({
      code: "custom",
      path: ["lastResortConfirmed"],
      message: "Confirm moving this organization to Last Resort",
    });
  }
  if (value.disposition === "do_not_call" && !value.phoneId) context.addIssue({ code: "custom", path: ["phoneId"], message: "Select the phone number to suppress." });
  if (value.disposition === "do_not_call" && !value.doNotCallConfirmed) context.addIssue({ code: "custom", path: ["doNotCallConfirmed"], message: "Confirm Do Not Call." });
  if (value.disposition === "do_not_call" && !value.doNotCallReason) context.addIssue({ code: "custom", path: ["doNotCallReason"], message: "Add a Do Not Call reason." });
  if (value.disposition === "do_not_call" && value.doNotCallPhoneId !== value.phoneId) context.addIssue({ code: "custom", path: ["doNotCallPhoneId"], message: "Confirm Do Not Call for the selected phone." });
  if (value.entryMode === "desktop" && value.method === "mobile_log") context.addIssue({ code: "custom", path: ["method"], message: "Desktop call entries cannot use the mobile log method." });
  if (value.entryMode === "mobile" && value.method !== "mobile_log") context.addIssue({ code: "custom", path: ["method"], message: "Mobile call entries must use the mobile log method." });
  if (value.direction === "incoming" && value.scriptKind !== "incoming_inquiry") context.addIssue({ code: "custom", path: ["scriptKind"], message: "Incoming calls must use the incoming inquiry script." });
  if (value.direction === "outgoing" && value.scriptKind === "incoming_inquiry") context.addIssue({ code: "custom", path: ["scriptKind"], message: "Outgoing calls require an outgoing script." });
  if (!value.organizationId && !value.contactId && !value.bookingId && !value.followUpId) {
    context.addIssue({
      code: "custom",
      path: ["organizationId"],
      message: "Link this call to an organization, contact, booking, or follow-up.",
    });
  }
});

export type ParsedCompleteCallInput = z.output<typeof completeCallInputSchema>;

export function parseCompleteCallInput(input: CompleteCallInput) {
  return completeCallInputSchema.safeParse(input);
}

export function validateApprovedBookingPatch(
  lockedBooking: Record<string, unknown>,
  updates: Record<string, unknown>,
  status: BookingStatus,
) {
  return bookingEditInputSchema.safeParse({ ...lockedBooking, ...updates, status });
}

export function approvedBookingWrite(
  validated: BookingEditInput,
  approved: Record<string, unknown>,
  authoritativeStatus: BookingStatus | null,
) {
  const write: Record<string, unknown> = {};
  for (const key of Object.keys(approved)) {
    write[key] = validated[key as keyof BookingEditInput];
  }
  if (authoritativeStatus) write.status = validated.status;
  return write;
}

export function validateApprovedContactPatch(
  lockedContact: Record<string, unknown>,
  organizationName: string | null,
  updates: Record<string, unknown>,
) {
  const formUpdates = Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [key, value ?? ""]),
  );
  return contactFormInputSchema.safeParse({
    firstName: lockedContact.firstName,
    lastName: lockedContact.lastName ?? "",
    organizationName: organizationName ?? "",
    jobTitle: lockedContact.jobTitle ?? "",
    email: lockedContact.email ?? "",
    phone: lockedContact.phone ?? "",
    address1: lockedContact.address1 ?? "",
    address2: lockedContact.address2 ?? "",
    city: lockedContact.city ?? "",
    region: lockedContact.region ?? "",
    postalCode: lockedContact.postalCode ?? "",
    ...formUpdates,
  });
}

export function approvedContactWrite(
  validated: ContactFields,
  approved: Record<string, unknown>,
) {
  const write: Record<string, unknown> = {};
  for (const key of Object.keys(approved)) {
    if (key === "organizationName") continue;
    write[key] = validated[key as keyof ContactFields];
  }
  return write;
}
