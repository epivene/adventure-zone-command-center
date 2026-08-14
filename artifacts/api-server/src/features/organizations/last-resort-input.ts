import { z } from "zod";

export const organizationIdSchema = z.uuid();

export const setLastResortInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    enabled: z.boolean(),
    reason: z.string().trim().max(2_000),
  })
  .superRefine((value, context) => {
    if (value.enabled && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Add a Last Resort reason",
      });
    }
  });

export type SetLastResortInput = z.output<typeof setLastResortInputSchema>;

export const organizationListQuerySchema = z
  .object({
    q: z.string().catch("").default(""),
    lastResort: z.enum(["all", "only"]).catch("all").default("all"),
    leg: z.string().catch("").default(""),
    includeRetired: z
      .union([z.literal("true"), z.literal("1")])
      .transform(() => true)
      .catch(false)
      .default(false),
    page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).catch(50).default(50),
  })
  .transform(({ q, lastResort, leg, includeRetired, page, pageSize }) => ({
    search: q.trim().replace(/\s+/g, " "),
    lastResort,
    travelLegId: z.uuid().safeParse(leg).success ? leg : null,
    includeRetired: includeRetired as boolean,
    page,
    pageSize,
  }));

export type OrganizationListQuery = z.output<typeof organizationListQuerySchema>;
