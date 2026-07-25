import { z } from "zod";

import {
  bookingStatusValues,
  probabilityValues,
} from "@/features/bookings/booking-types";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";

const coreBookingInputShape = {
  name: z.string().trim().min(1, "Event name is required"),
  city: z.string().trim().min(1, "City is required"),
  region: z.string().trim().min(2, "State is required"),
  probability: z.enum(probabilityValues),
};

export const bookingEditInputSchema = z
  .object(coreBookingInputShape)
  .transform((input) => ({
    ...input,
    region: input.region.toUpperCase(),
  }));

export const bookingInputSchema = z
  .object({
    ...coreBookingInputShape,
    status: z.enum(bookingStatusValues),
    nextActionKind: z.string(),
    nextActionDueAt: z.union([z.literal(""), z.coerce.date()]),
  })
  .superRefine((input, context) => {
    if (!isActiveStatus(input.status)) return;

    if (!input.nextActionKind.trim()) {
      context.addIssue({
        code: "custom",
        message: "Choose the next action",
        path: ["nextActionKind"],
      });
    }

    if (!input.nextActionDueAt) {
      context.addIssue({
        code: "custom",
        message: "Choose the next follow-up date",
        path: ["nextActionDueAt"],
      });
    }
  })
  .transform((input) => ({
    ...input,
    region: input.region.toUpperCase(),
    nextActionKind: input.nextActionKind.trim(),
    nextActionDueAt: input.nextActionDueAt || null,
  }));

export type BookingFormInput = z.output<typeof bookingInputSchema>;
export type BookingEditInput = z.output<typeof bookingEditInputSchema>;
