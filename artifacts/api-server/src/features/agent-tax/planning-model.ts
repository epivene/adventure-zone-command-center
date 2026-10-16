import { z } from "zod";

const money = z.number().int().min(0).max(1_000_000_000);
export const estimateYear = z.coerce.number().int().refine(y => y === 2025 || y === 2026);
export const estimateSettings = z.object({
  filingStatus: z.enum(["single","married_joint","married_separate","head_household"]),
  fullYearNdResident: z.literal(true),
  additionalIncomeCents: money, additionalExpensesCents: money,
  nonDeductibleExpensesCents: money,
  wagesCents: money, ownSocialSecurityWagesCents: money, medicareWagesCents: money,
  otherIncomeCents: money, otherAdjustmentsCents: money,
  deductionOverrideCents: money.nullable(), qbiDeductionCents: money,
  ndAdjustmentCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  federalCreditsCents: money, ndCreditsCents: money,
  federalWithholdingCents: money, ndWithholdingCents: money,
  federalPaymentsCents: money, ndPaymentsCents: money,
}).strict();
export type EstimateSettings = z.infer<typeof estimateSettings>;
export const saveEstimateSettings = z.object({
  expectedRevision: z.number().int().min(0), settings: estimateSettings,
}).strict();

export const payItemInput = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["weekly","manual"]),
  earnedDate: z.string().date(),
  dueDate: z.string().date().nullable(),
  amountCents: money.refine(n => n > 0),
  notes: z.string().trim().max(5000).nullable(),
}).strict();
export type PayItemInput = z.infer<typeof payItemInput>;
export const updatePayItem = payItemInput.extend({expectedRevision:z.number().int().positive()});
export const payPaymentInput = z.object({
  amountCents: money.refine(n => n > 0),
  recordDate: z.string().date(),
  paymentMethod: z.enum(["venmo","cash","bank","check","card","other"]),
  counterparty: z.string().trim().max(250).nullable(),
  notes: z.string().trim().max(5000).nullable(),
  expectedRevision: z.number().int().positive(),
  paymentRequestId: z.string().uuid(),
}).strict();
export type PayPaymentInput = z.infer<typeof payPaymentInput>;
