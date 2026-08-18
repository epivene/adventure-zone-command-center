import { z } from "zod";

export const managerAssistantContextKindValues = [
  "leg",
  "booking",
  "route",
  "operations",
] as const;

export const managerContextInputSchema = z
  .object({
    contextKind: z.enum(managerAssistantContextKindValues),
    contextRecordId: z.string().uuid(),
  })
  .strict();

export const managerAskInputSchema = managerContextInputSchema
  .extend({
    question: z.string().trim().min(1).max(4000),
  })
  .strict();

export type ManagerContextInput = z.infer<typeof managerContextInputSchema>;
export type ManagerAskInput = z.infer<typeof managerAskInputSchema>;
