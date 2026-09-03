import { z } from "zod";

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const websiteInquirySubmissionSchema = z
  .object({
    submissionId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(320),
    eventName: z.string().trim().min(1).max(240),
    eventDate: z
      .string()
      .trim()
      .refine(validCalendarDate, "Enter a valid event date.")
      .optional(),
    eventLocation: z.string().trim().max(300).optional(),
    packageInterest: z.string().trim().max(160).optional(),
    message: z.string().trim().min(1).max(5000),
    website: z.literal(""),
    pageUrl: z.string().trim().url().max(2048),
  })
  .strict();

export type WebsiteInquirySubmission = z.infer<
  typeof websiteInquirySubmissionSchema
>;
