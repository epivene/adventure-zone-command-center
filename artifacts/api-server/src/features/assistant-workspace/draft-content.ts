import { z } from "zod";
import { sanitizeCustomEmailHtml } from "../communication-templates/email-template-compiler";
export const draftContentSchema = z
  .object({
    to: z.array(z.email()).min(1).max(20),
    cc: z.array(z.email()).max(20),
    subject: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[^\r\n]*$/),
    html: z.string().min(1).max(150000),
    text: z.string().min(1).max(30000),
    threadId: z.string().max(256).nullable(),
    attachmentHashes: z.array(z.string()).max(15),
    attachmentIds: z.array(z.string().uuid()).max(15),
    organizationId: z.string().uuid().nullable(),
    templateId: z.string().uuid().nullable(),
    templateVersion: z.string().nullable(),
    batchId: z.string().uuid().nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    eventYear: z.number().int().min(2000).max(2200).nullable().optional(),
    bookingId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type StoredDraftContent = z.infer<typeof draftContentSchema>;
export function cleanDraftContent(raw: StoredDraftContent) {
  const c = draftContentSchema.parse(raw);
  c.html = sanitizeCustomEmailHtml(c.html);
  if (c.attachmentIds.length !== c.attachmentHashes.length)
    throw new Error("ASSISTANT_ATTACHMENTS_INVALID");
  return c;
}
