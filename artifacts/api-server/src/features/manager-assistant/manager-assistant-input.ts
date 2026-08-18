import { z } from "zod";

export const managerAssistantContextKindValues = [
  "leg",
  "booking",
  "route",
  "operations",
] as const;

const ianaTimeZone = z.string().trim().min(1).max(120).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}, "Invalid time zone");

export const managerContextInputSchema = z
  .object({
    contextKind: z.enum(managerAssistantContextKindValues),
    contextRecordId: z.string().uuid(),
  })
  .strict();

export const managerAskInputSchema = managerContextInputSchema
  .extend({
    question: z.string().trim().min(1).max(4000),
    timeZone: ianaTimeZone.optional(),
  })
  .strict();

export type ManagerContextInput = z.infer<typeof managerContextInputSchema>;
export type ManagerAskInput = z.infer<typeof managerAskInputSchema>;
