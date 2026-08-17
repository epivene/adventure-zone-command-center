import { z } from "zod";

import {
  specialRequestTreatmentValues,
} from "@/features/packages/package-types";

const nullableTrimmedString = z
  .union([z.string(), z.null()])
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
    customerDescription: nullableTrimmedString,
    bookingTalkingPoints: nullableTrimmedString,
    operationalRequirements: nullableTrimmedString,
    setupNotes: nullableTrimmedString,
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
