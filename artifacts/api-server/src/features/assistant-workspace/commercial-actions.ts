import { z } from "zod";
import type { Selection } from "./contracts";
const uuid = z.string().uuid(),
  text = z.string().max(12000),
  cents = z.number().int().min(0).max(100000000),
  date = z.iso.date();
const scope = {
  organizationId: uuid,
  eventYear: z.number().int().min(2000).max(2200),
};
const signer = z
  .object({
    name: text,
    role: text,
    email: z.string().email(),
    phone: text,
    order: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();
const commercialTerms = z.discriminatedUnion("arrangement", [
  z
    .object({
      arrangement: z.literal("guaranteed_fee"),
      totalFeeCents: cents,
      depositCents: cents,
      depositDueDate: date,
      balanceCents: cents,
      paymentTiming: text,
      discountWording: text,
    })
    .strict(),
  z
    .object({
      arrangement: z.literal("pay_for_play"),
      eventShareBasisPoints: z.number().int().min(1).max(10000),
      settlementTiming: text,
      ticketAuthority: text,
      collectionArrangement: text,
      upfrontChargeCents: cents,
    })
    .strict(),
  z
    .object({
      arrangement: z.literal("guarantee_plus_percentage"),
      guaranteeCents: cents,
      depositCents: cents,
      depositDueDate: date,
      balanceCents: cents,
      paymentTiming: text,
      eventShareBasisPoints: z.number().int().min(1).max(10000),
      percentageBase: text,
      ticketAuthority: text,
      collectionArrangement: text,
    })
    .strict(),
]);
export const contractValuesSchema = z
  .object({
    organizationId: uuid,
    organizationName: text,
    bookingId: uuid,
    eventName: text,
    venueName: text,
    venueAddress: z
      .object({
        address1: text,
        address2: text,
        city: text,
        region: text,
        postalCode: text,
      })
      .strict(),
    eventStartDate: date,
    eventEndDate: date,
    eventSigner: signer,
    internalSigner: signer,
    packages: z
      .array(z.object({ id: z.string().min(1), name: text }).strict())
      .max(12),
    physicalAttractionTotal: z.number().int().min(0).max(100).nullable(),
    travelLegName: text,
    arrangement: z.enum([
      "guaranteed_fee",
      "pay_for_play",
      "guarantee_plus_percentage",
    ]),
    commercialTerms,
    operationalTerms: z
      .object({
        operatingStartDate: date,
        operatingEndDate: date,
        dailyHours: text,
        workDayCount: z.number().int().min(1),
        arrivalDate: date,
        departureDate: date,
        dateOverrideReason: text,
        attractionDescription: text,
        spaceRequirement: text,
        exclusivity: text,
        powerRequirement: text,
        waterRequirement: text,
        forkliftRequirement: text,
        lodgingRequirement: text,
        restroomAccess: text,
        licensingResponsibilities: text,
        setupTeardownClause: text,
        additionalTerms: text,
        confirmed: z.boolean(),
      })
      .strict(),
    coi: z
      .object({
        certificateHolderName: text,
        certificateHolderAddress: text,
        additionalInsuredWording: text,
      })
      .strict(),
  })
  .strict();
export const commercialActionSchemas = {
  create_template_document: z
    .object({ ...scope, bookingId: uuid.nullable(), templateId: uuid })
    .strict(),
  start_contract_draft: z.object({ ...scope, bookingId: uuid }).strict(),
  save_contract_draft: z
    .object({ ...scope, values: contractValuesSchema })
    .strict(),
  generate_contract_pdf: z.object({ ...scope }).strict(),
  register_invoice: z
    .object({
      ...scope,
      bookingId: uuid,
      documentId: uuid,
      invoiceNumber: z.string().trim().min(1).max(100),
      totalCents: cents,
      depositCents: cents,
      issueDate: date,
      depositDueDate: date.nullable(),
      balanceDueDate: date.nullable(),
      notes: z.string().max(5000).nullable(),
    })
    .strict()
    .refine((a) => a.depositCents <= a.totalCents),
  record_invoice_payment: z
    .object({
      ...scope,
      amountCents: cents.refine((c) => c > 0),
      receivedDate: date,
      method: z.string().trim().min(1).max(100),
      receiptReference: z.string().trim().min(3).max(500),
    })
    .strict(),
  confirm_signed_contract: z
    .object({
      ...scope,
      fileId: uuid,
      fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
      reviewNote: z.string().trim().min(3).max(1000),
    })
    .strict(),
};
export type CommercialKind = keyof typeof commercialActionSchemas;
export function parseCommercialAction(kind: string, raw: unknown) {
  const schema = commercialActionSchemas[kind as CommercialKind];
  if (!schema) throw new Error("ASSISTANT_CAPABILITY_UNAVAILABLE");
  return schema.parse(raw);
}
export function assertCommercialScope(
  selection: Selection,
  target: { organization_id: string; event_year: number | null },
  args: { organizationId: string; eventYear: number },
) {
  if (
    !selection.organizationIds.includes(args.organizationId) ||
    target.organization_id !== args.organizationId
  )
    throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
  if (
    target.event_year !== args.eventYear ||
    selection.eventYear !== args.eventYear
  )
    throw new Error("ASSISTANT_EVENT_YEAR_MISMATCH");
}
export function confirmationFor(kind: string) {
  return kind === "record_invoice_payment"
    ? "payment_received"
    : kind === "confirm_signed_contract"
      ? "signatures_reviewed"
      : null;
}
