import { z } from "zod";

const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());
const actorId = z.string().trim().min(1, "An actor is required.");
const stableCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "A stable resource code is required.")
  .max(100, "The stable resource code is too long.")
  .regex(
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and underscores for the stable code.",
  );
const trimmedLabel = z
  .string()
  .trim()
  .min(1, "This field is required.")
  .max(100, "This field is too long.");
const optionalIdentityText = (max: number) =>
  z.string().trim().max(max).nullable().default(null);

export const packageCountCategoryValues = [
  "main_attraction",
  "game_extra",
  "special_shared",
] as const;
export type PackageCountCategory = (typeof packageCountCategoryValues)[number];

export const resourceChecklistTagValues = [
  "inflatable",
  "blower_powered",
  "wet_attraction",
  "multi_section",
  "action_pursuit",
  "carnival_game",
  "trailer_shared",
] as const;
export type ResourceChecklistTag = (typeof resourceChecklistTagValues)[number];

export const configureBookingResourcesInputSchema = z
  .object({
    bookingId: canonicalUuid,
    resourceIds: z.array(canonicalUuid),
    actorId,
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.resourceIds).size !== input.resourceIds.length) {
      context.addIssue({ code: "custom", message: "Choose each resource only once." });
    }
  });

export const acknowledgeResourceConflictInputSchema = z
  .object({
    bookingId: canonicalUuid,
    conflictKey: z.string().trim().min(1, "Choose a current conflict."),
    reason: z.string().trim().min(1, "Add a reason for the override."),
    actorId,
  })
  .strict();

export const resourceInputSchema = z
  .object({
    id: canonicalUuid.nullable(),
    code: stableCode,
    name: trimmedLabel,
    category: trimmedLabel,
    countsAsAttraction: z.boolean(),
    packageCountCategory: z.enum(packageCountCategoryValues).default("main_attraction"),
    packageTemplateIds: z.array(canonicalUuid),
    checklistTags: z.array(z.enum(resourceChecklistTagValues)).optional(),
    yearBuilt: z.number().int().min(1900).max(2100).nullable().default(null),
    make: optionalIdentityText(120),
    model: optionalIdentityText(120),
    serialNumber: optionalIdentityText(120),
    inspectionIdentityNotes: optionalIdentityText(2000),
    normalTravelLegId: canonicalUuid.nullable(),
    movable: z.boolean(),
    setupMinutes: z.number().int().nonnegative(),
    teardownMinutes: z.number().int().nonnegative(),
    minimumTransferMinutes: z.number().int().nonnegative(),
    status: z.enum(["available", "unavailable", "maintenance", "archived"]),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.packageTemplateIds).size !== input.packageTemplateIds.length) {
      context.addIssue({
        code: "custom",
        message: "Choose each package tag only once.",
        path: ["packageTemplateIds"],
      });
    }
    if (input.checklistTags && new Set(input.checklistTags).size !== input.checklistTags.length) {
      context.addIssue({
        code: "custom",
        message: "Choose each checklist tag only once.",
        path: ["checklistTags"],
      });
    }
  });

export type ConfigureBookingResourcesInput = z.output<
  typeof configureBookingResourcesInputSchema
>;
export type AcknowledgeResourceConflictInput = z.output<
  typeof acknowledgeResourceConflictInputSchema
>;
/** Input keeps new optional/defaulted fields source-compatible with legacy callers. */
export type ResourceInput = z.input<typeof resourceInputSchema>;
export type ParsedResourceInput = z.output<typeof resourceInputSchema>;
