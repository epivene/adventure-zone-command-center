import { z } from "zod";

import { activityKindValues } from "@/db/schema";

const activityParentInputSchema = z.object({
  organizationId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  bookingId: z.uuid().optional(),
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
  activityId: z.uuid(),
  body: activityText,
  reason: z.string().trim().min(1, "Add a reason for the edit."),
});

export type ActivityCreateInput = z.output<typeof createActivityInputSchema>;
export type ActivityEditInput = z.output<typeof editActivityInputSchema>;
