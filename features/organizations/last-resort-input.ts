import { z } from "zod";

export const setLastResortInputSchema = z
  .object({
    organizationId: z.uuid(),
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
  })
  .transform(({ q, lastResort, leg }) => ({
    search: q.trim().replace(/\s+/g, " "),
    lastResort,
    travelLegId: z.uuid().safeParse(leg).success ? leg : null,
  }));

export type OrganizationListQuery = z.output<typeof organizationListQuerySchema>;
