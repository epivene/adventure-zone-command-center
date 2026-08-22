import { z } from "zod";

import {
  specialRequestTreatmentValues,
} from "@/features/packages/package-types";

const nullableTrimmedString = z
  .union([z.string(), z.null()])
  .transform((value) => value?.trim() || null);
const optionalNullableTrimmedString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => value?.trim() || null);

const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());

function uniqueValues(
  values: readonly string[],
  context: z.RefinementCtx,
  message: string,
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message });
  }
}

const manualAttributionInputSchema = z
  .object({
    bookingResourceAssignmentId: canonicalUuid,
    packageTemplateIds: z.array(canonicalUuid).nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.packageTemplateIds) {
      uniqueValues(
        input.packageTemplateIds,
        context,
        "Choose each manually attributed package only once.",
      );
    }
  });

export const configureBookingPackagesInputSchema = z
  .object({
    bookingId: canonicalUuid,
    packageTemplateIds: z.array(canonicalUuid),
    physicalAttractionTotal: z.number().int().nonnegative().nullable(),
    attractionTotalApprovalReason: nullableTrimmedString,
    manualAttributions: z.array(manualAttributionInputSchema),
  })
  .strict()
  .superRefine((input, context) => {
    uniqueValues(
      input.packageTemplateIds,
      context,
      "Choose each package only once.",
    );
    uniqueValues(
      input.manualAttributions.map(
        ({ bookingResourceAssignmentId }) => bookingResourceAssignmentId,
      ),
      context,
      "Configure each resource assignment only once.",
    );
  });

export const addSpecialRequestInputSchema = z
  .object({
    bookingId: canonicalUuid,
    description: z.string().trim().min(1, "Describe the special request."),
    treatment: z.enum(specialRequestTreatmentValues),
  })
  .strict();

export const decideSpecialRequestInputSchema = z
  .object({
    specialRequestId: canonicalUuid,
    decision: z.enum(["approved", "declined"]),
    reason: z.string().trim().min(1, "Add a reason for the decision."),
  })
  .strict();

export const packageTemplateInputSchema = z
  .object({
    id: canonicalUuid,
    name: z
      .string()
      .trim()
      .min(1, "Package name is required.")
      .max(100, "Package name is too long."),
    basePriceCents: z
      .number()
      .int("Base price must be in whole cents.")
      .nonnegative("Base price cannot be negative.")
      .nullable(),
    baseAttractionCount: z
      .number()
      .int("Suggested attraction count must be a whole number.")
      .positive("Suggested attraction count must be at least one."),
    minimumAttractionCount: z
      .number()
      .int("Normal minimum must be a whole number.")
      .positive("Normal minimum must be at least one."),
    maximumAttractionCount: z
      .number()
      .int("Normal maximum must be a whole number.")
      .positive("Normal maximum must be at least one."),
    baseDurationMinDays: z
      .number()
      .int("Minimum duration must be a whole number of days.")
      .positive("Minimum duration must be at least one day.")
      .max(31, "Minimum duration is too large.")
      .nullable()
      .optional()
      .default(null),
    baseDurationMaxDays: z
      .number()
      .int("Maximum duration must be a whole number of days.")
      .positive("Maximum duration must be at least one day.")
      .max(31, "Maximum duration is too large.")
      .nullable()
      .optional()
      .default(null),
    customerDescription: nullableTrimmedString,
    bookingTalkingPoints: nullableTrimmedString,
    operationalRequirements: nullableTrimmedString,
    setupNotes: nullableTrimmedString,
    knowledgeReviewNote: optionalNullableTrimmedString,
    active: z.boolean(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.maximumAttractionCount < input.minimumAttractionCount) {
      context.addIssue({
        code: "custom",
        path: ["maximumAttractionCount"],
        message: "Maximum must be at least the minimum.",
      });
    }
    if (
      input.baseDurationMinDays !== null &&
      input.baseDurationMaxDays !== null &&
      input.baseDurationMaxDays < input.baseDurationMinDays
    ) {
      context.addIssue({
        code: "custom",
        path: ["baseDurationMaxDays"],
        message: "Maximum duration must be at least the minimum duration.",
      });
    }
  });

export type ConfigureBookingPackagesInput = z.output<
  typeof configureBookingPackagesInputSchema
>;
export type AddSpecialRequestInput = z.output<
  typeof addSpecialRequestInputSchema
>;
export type DecideSpecialRequestInput = z.output<
  typeof decideSpecialRequestInputSchema
>;
export type PackageTemplateInput = z.output<
  typeof packageTemplateInputSchema
>;
