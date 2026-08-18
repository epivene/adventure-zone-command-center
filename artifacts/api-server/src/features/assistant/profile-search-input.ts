import { z } from "zod";

export const profileSearchInputSchema = z.object({
  q: z.string().trim().min(1).max(240),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(80).optional(),
  packageName: z.string().trim().max(160).optional(),
  overdueFollowUp: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
}).strict();
