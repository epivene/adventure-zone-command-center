import { z } from "zod";
export const messageInput = z
  .object({
    requestKey: z.string().min(1).max(128),
    text: z.string().trim().min(1).max(20000),
    model: z.string().max(128).optional(),
  })
  .strict();
export const actionInput = z
  .object({
    requestKey: z.string().min(1).max(128),
    revision: z.string().nullable(),
  })
  .strict();
