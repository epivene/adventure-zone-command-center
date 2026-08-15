import { z } from "zod";

import { activityKindValues, callDispositionValues } from "@/db/schema";

const activityParentInputSchema = z.object({
  organizationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
});

const activityText = z.string().trim().min(1, "Add activity text.");

export const createActivityInputSchema = activityParentInputSchema
  .extend({
    kind: z.enum(activityKindValues),
    body: activityText,
    occurredAt: z.date(),
  })
  .refine(
    (value) => Boolean(value.organizationId || value.contactId || value.bookingId),
    {
      message: "Link the activity to an organization, contact, or booking.",
    },
  );

export const editActivityInputSchema = z.object({
  activityId: z.string().uuid(),
  body: activityText,
  reason: z.string().trim().min(1, "Add a reason for the edit."),
  callOutcome: z.enum(callDispositionValues).optional(),
});

export const deleteActivityInputSchema = z.object({
  activityId: z.string().uuid(),
});

export type ActivityCreateInput = z.output<typeof createActivityInputSchema>;
export type ActivityEditInput = z.output<typeof editActivityInputSchema>;
export type ActivityDeleteInput = z.output<typeof deleteActivityInputSchema>;
