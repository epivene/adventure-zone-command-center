import { z } from "zod";
import {
  commercialOfferAudienceValues,
  commercialOfferCalculationValues,
  commercialOfferDeadlineModeValues,
  commercialOfferKindValues,
  commercialOfferStackPolicyValues,
  commercialOfferStateValues,
} from "@workspace/db";

const nullableText = (max: number) =>
  z.union([z.string().max(max), z.null()]).transform((value) => value?.trim() || null);

export const commercialOfferInputSchema = z
  .object({
    code: z.string().trim().min(1).max(80).regex(/^[a-z0-9_]+$/),
    name: z.string().trim().min(1).max(160),
    kind: z.enum(commercialOfferKindValues),
    state: z.enum(commercialOfferStateValues),
    audience: z.enum(commercialOfferAudienceValues),
    calculationType: z.enum(commercialOfferCalculationValues),
    amountCents: z.number().int().min(0).nullable(),
    amountBasisPoints: z.number().int().min(0).max(10000).nullable(),
    calculationScope: nullableText(200),
    stackPolicy: z.enum(commercialOfferStackPolicyValues),
    appliesToPackageCodes: z.array(z.string().trim().min(1).max(100)).default([]),
    newCustomerOnly: z.boolean(),
    repeatCustomerOnly: z.boolean(),
    requiresOwnerConfirmation: z.boolean(),
    deadlineMode: z.enum(commercialOfferDeadlineModeValues),
    deadlineDays: z.number().int().min(0).nullable(),
    fixedDeadline: z.union([z.string().date(), z.null()]),
    customerSummary: nullableText(2000),
    internalConditions: z.string().trim().min(1).max(4000),
    sourceConflictNote: nullableText(4000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.calculationType === "fixed_cents" && value.amountCents === null) {
      ctx.addIssue({
        code: "custom",
        path: ["amountCents"],
        message: "Fixed offers require amountCents.",
      });
    }
    if (
      value.calculationType === "percent_basis_points" &&
      value.amountBasisPoints === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["amountBasisPoints"],
        message: "Percent offers require amountBasisPoints.",
      });
    }
    if (value.deadlineMode === "days_after_trigger" && value.deadlineDays === null) {
      ctx.addIssue({
        code: "custom",
        path: ["deadlineDays"],
        message: "Relative deadlines require deadlineDays.",
      });
    }
    if (value.deadlineMode === "fixed_date" && value.fixedDeadline === null) {
      ctx.addIssue({
        code: "custom",
        path: ["fixedDeadline"],
        message: "Fixed deadlines require fixedDeadline.",
      });
    }
    if (value.newCustomerOnly && value.repeatCustomerOnly) {
      ctx.addIssue({
        code: "custom",
        path: ["newCustomerOnly"],
        message: "An offer cannot be both new-customer-only and repeat-customer-only.",
      });
    }
    if (new Set(value.appliesToPackageCodes).size !== value.appliesToPackageCodes.length) {
      ctx.addIssue({
        code: "custom",
        path: ["appliesToPackageCodes"],
        message: "Choose each package code only once.",
      });
    }
  });

export type CommercialOfferInput = z.output<typeof commercialOfferInputSchema>;
