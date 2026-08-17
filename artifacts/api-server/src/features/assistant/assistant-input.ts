import { z } from "zod";

import { assistantContextKindValues } from "./assistant-types";

const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());

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
  })
  .strict();

export type GetAssistantContextInput = z.output<
  typeof getAssistantContextInputSchema
>;
export type AskBookingAssistantInput = z.output<
  typeof askBookingAssistantInputSchema
>;
