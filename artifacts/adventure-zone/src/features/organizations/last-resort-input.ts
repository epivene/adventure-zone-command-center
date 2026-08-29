import { z } from "zod";

export const organizationIdSchema = z.string().uuid();

export const profileTypeValues = [
  "fair",
  "city_government",
  "festival_event",
  "venue",
  "school",
  "tribe",
  "association",
  "company",
  "other",
] as const;

export const profileTypeOptions = [
  { value: "fair", label: "Fair" },
  { value: "festival_event", label: "Event / festival" },
  { value: "venue", label: "Venue" },
  { value: "city_government", label: "City / government" },
  { value: "school", label: "School" },
  { value: "tribe", label: "Tribe" },
  { value: "association", label: "Association" },
  { value: "company", label: "Company" },
  { value: "other", label: "Other" },
] as const;

export const profileSortValues = [
  "recently_updated",
  "least_recently_updated",
  "name_asc",
  "name_desc",
  "created_desc",
  "created_asc",
] as const;
export type ProfileSort = (typeof profileSortValues)[number];

function strategyInputSchema(label: string) {
  return z
    .object({
      organizationId: organizationIdSchema,
      enabled: z.boolean(),
      reason: z.string().trim().max(2_000),
    })
    .superRefine((value, context) => {
      if (value.enabled && !value.reason) {
        context.addIssue({ code: "custom", path: ["reason"], message: `Add a ${label} reason` });
      }
    });
}

export const setLastResortInputSchema = strategyInputSchema("Last Resort");
export type SetLastResortInput = z.output<typeof setLastResortInputSchema>;

export const setFillerInputSchema = strategyInputSchema("Filler");
export type SetFillerInput = z.output<typeof setFillerInputSchema>;

export const organizationListQuerySchema = z
  .object({
    q: z.string().catch("").default(""),
    lastResort: z.enum(["all", "only"]).catch("all").default("all"),
    filler: z.enum(["all", "only"]).catch("all").default("all"),
    leg: z.string().catch("").default(""),
    type: z.enum(["", ...profileTypeValues]).catch("").default(""),
    region: z.string().catch("").default(""),
    hasPhone: z.enum(["", "yes"]).catch("").default(""),
    hasEmail: z.enum(["", "yes"]).catch("").default(""),
    hasFollowUp: z.enum(["", "yes"]).catch("").default(""),
    hasBooking: z.enum(["", "yes"]).catch("").default(""),
    hasLocations: z.enum(["", "yes"]).catch("").default(""),
    showMembers: z.enum(["", "yes"]).catch("").default(""),
    contact: z.enum(["", "phone", "email"]).catch("").default(""),
    activity: z.enum(["", "followup", "booking"]).catch("").default(""),
    sort: z.enum(profileSortValues).catch("recently_updated").default("recently_updated"),
    includeRetired: z.union([z.literal("true"), z.literal("1")]).transform(() => true).catch(false).default(false),
    page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).catch(50).default(50),
  })
  .transform(({ q, lastResort, filler, leg, type, region, hasPhone, hasEmail, hasFollowUp, hasBooking, hasLocations, showMembers, contact, activity, sort, includeRetired, page, pageSize }) => ({
    search: q.trim().replace(/\s+/g, " "),
    lastResort,
    filler,
    travelLegId: z.string().uuid().safeParse(leg).success ? leg : null,
    placeType: type || null,
    region: region.trim() || null,
    hasPhone: hasPhone === "yes" || contact === "phone",
    hasEmail: hasEmail === "yes" || contact === "email",
    hasFollowUp: hasFollowUp === "yes" || activity === "followup",
    hasBooking: hasBooking === "yes" || activity === "booking",
    hasLocations: hasLocations === "yes",
    showMembers: showMembers === "yes",
    sort,
    includeRetired: includeRetired as boolean,
    page,
    pageSize,
  }));

export type OrganizationListQuery = z.output<typeof organizationListQuerySchema>;
