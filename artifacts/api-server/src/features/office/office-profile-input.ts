import { z } from "zod";

import {
  normalizeContactEmailValue,
  normalizeSendableContactEmail,
} from "@/features/contacts/contact-email-value";

const nullableText = (max = 4000) => z.union([z.string().max(max), z.null()]).transform((value) => value?.trim() || null);
const nullableContactEmail = z.union([z.string(), z.null()])
  .transform(normalizeContactEmailValue);
const nullableLocationEmail = z.union([z.string(), z.null()])
  .transform(normalizeContactEmailValue)
  .refine(
    (value) => value === null || normalizeSendableContactEmail(value) !== null,
    "Enter a valid email address.",
  );

const officeContactPhoneInputSchema = z.object({
  id: z.string().uuid().nullable(),
  number: z.string().trim().min(1),
  type: z.enum(["mobile", "office", "alternate", "unknown"]),
  extension: z.union([z.string(), z.null()]).transform((value) => value?.trim() || null).pipe(z.string().max(20).nullable()),
  label: z.union([z.string(), z.null()]).transform((value) => value?.trim() || null).pipe(z.string().max(60).nullable()),
  primary: z.boolean(),
}).strict();

export const officeProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  description: nullableText(5000).optional(),
  phone: nullableText(80).optional(),
  address1: nullableText(400).optional(),
  address2: nullableText(400).optional(),
  city: nullableText(120).optional(),
  region: nullableText(120).optional(),
  postalCode: nullableText(20).optional(),
  website: nullableText(2048).optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), { message: "No profile changes provided." });

export const officeContactInputSchema = z.object({
  firstName: z.string().trim().min(1).max(160),
  lastName: z.string().trim().max(160),
  jobTitle: nullableText(240),
  relationshipRole: nullableText(240),
  email: nullableContactEmail,
  address1: nullableText(400),
  address2: nullableText(400),
  city: nullableText(120),
  region: nullableText(120),
  postalCode: nullableText(20),
  phones: z.array(officeContactPhoneInputSchema).max(10),
}).strict().superRefine(({ phones }, context) => {
  if (phones.length && phones.filter((phone) => phone.primary).length !== 1) {
    context.addIssue({ code: "custom", path: ["phones"], message: "Choose one primary phone number." });
  }
});

export const officeLocationInputSchema = z.object({
  label: z.string().trim().min(1).max(240).optional(),
  venueName: nullableText(240).optional(),
  address1: nullableText(400).optional(),
  address2: nullableText(400).optional(),
  city: nullableText(120).optional(),
  region: nullableText(120).optional(),
  postalCode: nullableText(20).optional(),
  website: nullableText(2048).optional(),
  phone: nullableText(80).optional(),
  email: nullableLocationEmail.optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), { message: "No location changes provided." });

export const officeNoteInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
}).strict();

export type OfficeProfileInput = z.output<typeof officeProfileInputSchema>;
export type OfficeContactInput = z.output<typeof officeContactInputSchema>;
export type OfficeLocationInput = z.output<typeof officeLocationInputSchema>;
