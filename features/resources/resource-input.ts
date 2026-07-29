import { z } from "zod";

const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());
const actorId = z.string().trim().min(1, "An actor is required.");

export const configureBookingResourcesInputSchema = z
  .object({
    bookingId: canonicalUuid,
    resourceIds: z.array(canonicalUuid),
    actorId,
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.resourceIds).size !== input.resourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Choose each resource only once.",
      });
    }
  });

export const acknowledgeResourceConflictInputSchema = z
  .object({
    bookingId: canonicalUuid,
    conflictKey: z.string().trim().min(1, "Choose a current conflict."),
    reason: z.string().trim().min(1, "Add a reason for the override."),
    actorId,
  })
  .strict();

export type ConfigureBookingResourcesInput = z.output<
  typeof configureBookingResourcesInputSchema
>;

export type AcknowledgeResourceConflictInput = z.output<
  typeof acknowledgeResourceConflictInputSchema
>;
