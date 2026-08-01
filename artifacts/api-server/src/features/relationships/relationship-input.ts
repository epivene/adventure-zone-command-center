import { z } from "zod";

const nullableRoleSchema = z
  .union([z.string().max(200), z.null()])
  .transform((value) => value?.trim() || null);

export const associatePersonWithPlaceSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid(),
  role: nullableRoleSchema,
});

export const setPersonPrimaryPlaceSchema = z.object({
  contactId: z.uuid(),
  organizationId: z.uuid().nullable(),
});

export const setPlacePrimaryPersonSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid(),
});

export const setPlacePersonActiveSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid(),
  active: z.boolean(),
});
