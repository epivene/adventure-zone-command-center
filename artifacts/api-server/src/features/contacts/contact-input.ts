import { z } from "zod";

import { normalizeContactEmailValue } from "@/features/contacts/contact-email-value";
import { contactSyncStateValues } from "@/features/contacts/contact-types";

export const requiredContactTextSchema = z.string().trim().min(1);
export const nullableContactTextSchema = z
  .union([z.string(), z.null()])
  .transform((value) => value?.trim() || null);
export const nullableContactEmailSchema = z
  .union([z.string(), z.null()])
  .transform(normalizeContactEmailValue);

export const contactPhoneInputSchema = z.object({
  id: z.string().uuid().nullable(),
  number: z.string().trim().min(1),
  type: z.enum(["mobile", "office", "alternate", "unknown"]),
  extension: z.union([z.string(), z.null()]).transform(value => value?.trim() || null).pipe(z.string().max(20).nullable()),
  label: z.union([z.string(), z.null()]).transform(value => value?.trim() || null).pipe(z.string().max(60).nullable()),
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

export const atomicContactEditSchema = z.object({
  contact: contactFormInputSchema,
  phones: z.array(contactPhoneInputSchema).max(10),
}).superRefine(({ phones }, context) => {
  if (phones.length && phones.filter(phone => phone.primary).length !== 1) {
    context.addIssue({ code: "custom", message: "Choose one primary phone number.", path: ["phones"] });
  }
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
