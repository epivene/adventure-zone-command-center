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
  .transform((value) => value || null);

export const contactPhoneInputSchema = z.object({
  id: z.string().uuid().nullable(),
  number: z.string().trim().min(1),
  type: z.enum(["mobile", "office", "alternate", "unknown"]),
  extension: z.string().trim().max(20).transform(value => value || null),
  label: z.string().trim().max(60).transform(value => value || null),
  primary: z.boolean(),
});

export const replaceContactPhonesSchema = z.object({
  phones: z.array(contactPhoneInputSchema).max(10),
}).superRefine(({ phones }, context) => {
  if (phones.length && phones.filter(phone => phone.primary).length !== 1) {
    context.addIssue({ code: "custom", message: "Choose one primary phone number.", path: ["phones"] });
  }
});

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
