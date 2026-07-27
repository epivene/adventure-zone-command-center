import { z } from "zod";

import { contactSyncStateValues } from "@/features/contacts/contact-types";

const requiredText = z.string().trim().min(1);
const nullableText = z
  .string()
  .trim()
  .transform((value) => value || null);
const nullableEmail = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) => value.length === 0 || z.email().safeParse(value).success,
    "Enter a valid email address.",
  )
  .transform((value) => value || null);

export const contactFormInputSchema = z.object({
  firstName: requiredText,
  lastName: z.string().trim(),
  organizationName: nullableText,
  jobTitle: nullableText,
  email: nullableEmail,
  phone: nullableText,
  address1: nullableText,
  address2: nullableText,
  city: nullableText,
  region: nullableText,
  postalCode: nullableText,
});

export type ContactFormInput = z.input<typeof contactFormInputSchema>;
export type ContactInput = z.output<typeof contactFormInputSchema>;

const listStateSchema = z
  .enum(["all", ...contactSyncStateValues])
  .catch("all");

export const contactListQuerySchema = z
  .object({
    q: z.string().catch("").default(""),
    state: listStateSchema.default("all"),
    page: z.coerce.number().int().positive().catch(1).default(1),
  })
  .transform(({ q, state, page }) => ({
    search: q.trim().replace(/\s+/g, " "),
    state,
    page,
    pageSize: 50,
  }));
