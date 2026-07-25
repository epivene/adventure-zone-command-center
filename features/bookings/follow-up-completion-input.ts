import { z } from "zod";

import { bookingStatusValues } from "@/features/bookings/booking-types";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";
import { parseBusinessDateInput } from "@/lib/business-date";

const requiredBusinessDateSchema = z
  .union([z.string(), z.date()])
  .transform((value, context) => {
    const parsed = parseBusinessDateInput(value);
    if (parsed) return parsed;
    context.addIssue({
      code: "custom",
      message: "Choose a valid next-action date.",
    });
    return z.NEVER;
  });

export const followUpCompletionInputSchema = z
  .object({
    followUpId: z.string().trim().min(1),
    outcome: z.string().trim().min(1, "Choose a call outcome."),
    status: z.enum(bookingStatusValues).optional(),
    nextAction: z
      .object({
        kind: z.string().trim().min(1),
        dueAt: requiredBusinessDateSchema,
      })
      .nullable(),
  })
  .superRefine((input, context) => {
    if (input.status && isActiveStatus(input.status) && !input.nextAction) {
      context.addIssue({
        code: "custom",
        message: "Choose a next action and date before completing this call.",
        path: ["nextAction"],
      });
    }
  });

export type FollowUpCompletionActionError = {
  code: "INVALID_COMPLETION_INPUT";
};
