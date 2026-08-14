import { z } from "zod";

export const setOrganizationParentInputSchema = z.object({
  childId: z.string().uuid(),
  parentId: z.string().uuid(),
});

export const ungroupOrganizationInputSchema = z.object({
  childId: z.string().uuid(),
});

export const createOrganizationParentInputSchema = z.object({
  name: z.string().trim().min(1).max(240),
  website: z.string().trim().max(2048).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  childIds: z.array(z.string().uuid()).min(1),
});

export type SetOrganizationParentInput = z.infer<
  typeof setOrganizationParentInputSchema
>;
export type UngroupOrganizationInput = z.infer<
  typeof ungroupOrganizationInputSchema
>;
export type CreateOrganizationParentInput = z.infer<
  typeof createOrganizationParentInputSchema
>;
