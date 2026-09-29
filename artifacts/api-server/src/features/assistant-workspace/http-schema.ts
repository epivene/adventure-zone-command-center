import { z } from "zod";
export const messageInput = z
  .object({
    requestKey: z.string().min(1).max(128),
    text: z.string().trim().max(20000),
    attachmentIds: z
      .array(z.string().uuid().toLowerCase())
      .max(4)
      .refine((ids) => new Set(ids).size === ids.length)
      .default([]),
    model: z.string().max(128).optional(),
    reconcileOnly: z.boolean().optional(),
  })
  .strict()
  .refine((input) => !!input.text || input.attachmentIds.length > 0);
export const actionInput = z
  .object({
    requestKey: z.string().min(1).max(128),
    revision: z.string().nullable(),
    confirmation: z
      .enum(["payment_received", "signatures_reviewed"])
      .optional(),
  })
  .strict();
