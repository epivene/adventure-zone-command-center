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
]);

const nullableText = z.union([z.string(), z.null()]).transform((value) => value?.trim() || null);
const nullableEmail = z
  .union([z.string(), z.null()])
  .transform((value) => value ?? "")
  .pipe(nullableContactEmailSchema);

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
  startsAt: z.date().nullable().optional(),
  endsAt: z.date().nullable().optional(),
  status: z.enum(bookingStatusValues).optional(),
  probability: z.enum(probabilityValues).optional(),
  travelLegId: z.uuid().nullable().optional(),
  notes: nullableText.optional(),
}).strict();

export const completeCallInputSchema = z.object({
  requestKey: z.uuid(),
  organizationId: z.uuid().nullable(),
  contactId: z.uuid().nullable(),
  bookingId: z.uuid().nullable(),
  followUpId: z.uuid().nullable(),
  note: z.string().trim().min(1, "Add a call note."),
  disposition: callDispositionSchema,
  resultingBookingStatus: z.enum(bookingStatusValues).nullable(),
  startedAt: z.date(),
  endedAt: z.date(),
  nextAction: z.object({
    kind: z.string().trim().min(1, "Choose the next action"),
    dueAt: z.date(),
  }).nullable(),
  lastResortReason: z
    .union([z.string().trim().max(2_000), z.null()])
    .transform((value) => value || null),
  lastResortConfirmed: z.boolean(),
  approvedContactUpdates: approvedContactUpdatesSchema.nullable(),
  approvedBookingUpdates: approvedBookingUpdatesSchema.nullable(),
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
