import { z } from "zod";

import { bookingStatusValues, probabilityValues } from "@/features/bookings/booking-types";
import type { CompleteCallInput } from "@/features/calls/call-types";

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

const approvedContactUpdatesSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  jobTitle: nullableText.optional(),
  email: nullableText.optional(),
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
  organizationId: z.uuid(),
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
  lastResortReason: nullableText,
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
});

export type ParsedCompleteCallInput = z.output<typeof completeCallInputSchema>;

export function parseCompleteCallInput(input: CompleteCallInput) {
  return completeCallInputSchema.safeParse(input);
}
