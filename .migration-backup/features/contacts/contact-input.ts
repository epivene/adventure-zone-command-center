import { z } from "zod";

import { contactSyncStateValues } from "@/features/contacts/contact-types";

export const requiredContactTextSchema = z.string().trim().min(1);
export const nullableContactTextSchema = z
  .string()
  .trim()
  .transform((value) => value || null);
export const nullableContactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) => value.length === 0 || z.email().safeParse(value).success,
    "Enter a valid email address.",
  )
  .transform((value) => value || null);

export const contactFormInputSchema = z.object({
  firstName: requiredContactTextSchema,
  lastName: z.string().trim(),
  organizationName: nullableContactTextSchema,
  jobTitle: nullableContactTextSchema,
  email: nullableContactEmailSchema,
  phone: nullableContactTextSchema,
  address1: nullableContactTextSchema,
  address2: nullableContactTextSchema,
  city: nullableContactTextSchema,
  region: nullableContactTextSchema,
  postalCode: nullableContactTextSchema,
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
