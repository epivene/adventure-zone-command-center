import { z } from "zod";

export const followUpIdSchema = z.string().uuid();

export const editFollowUpInputSchema = z
  .object({
    followUpId: followUpIdSchema,
    kind: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1, "Follow-up kind is required.")),
    dueAt: z
      .date()
      .refine(
        (value) => Number.isFinite(value.getTime()),
        "Follow-up due date is invalid.",
      ),
    completed: z.boolean(),
    outcome: z.string().nullable(),
  })
  .transform((input, context) => {
    const outcome = input.outcome?.trim() ?? null;
    if (input.completed && !outcome) {
      context.addIssue({
        code: "custom",
        message: "Completed follow-ups require an outcome.",
        path: ["outcome"],
      });
      return z.NEVER;
    }
    return {
      ...input,
      outcome: input.completed ? outcome : null,
    };
  });

export const deleteFollowUpInputSchema = z.object({
  followUpId: followUpIdSchema,
});
