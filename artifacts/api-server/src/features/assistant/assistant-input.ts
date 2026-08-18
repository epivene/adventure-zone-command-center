import { z } from "zod";

import { assistantContextKindValues } from "./assistant-types";

const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());
const ianaTimeZone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");

export const getAssistantContextInputSchema = z
  .object({
    contextKind: z.enum(assistantContextKindValues),
    contextRecordId: canonicalUuid,
  })
  .strict();

export const askBookingAssistantInputSchema = getAssistantContextInputSchema
  .extend({
    conversationId: canonicalUuid.optional(),
    question: z.string().trim().min(1, "Ask a question first.").max(4000),
    timeZone: ianaTimeZone.optional(),
  })
  .strict();

export type GetAssistantContextInput = z.output<
  typeof getAssistantContextInputSchema
>;
export type AskBookingAssistantInput = z.output<
  typeof askBookingAssistantInputSchema
>;
