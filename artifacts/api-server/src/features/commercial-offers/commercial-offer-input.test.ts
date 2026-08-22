import { describe, expect, it } from "vitest";
import { commercialOfferInputSchema } from "./commercial-offer-input";

const validOffer = {
  code: "sample_offer",
  name: "Sample offer",
  kind: "discount" as const,
  state: "proposed" as const,
  audience: "customer_safe" as const,
  calculationType: "fixed_cents" as const,
  amountCents: 50000,
  amountBasisPoints: null,
  calculationScope: "per booking",
  stackPolicy: "manual" as const,
  appliesToPackageCodes: [],
  newCustomerOnly: false,
  repeatCustomerOnly: false,
  requiresOwnerConfirmation: true,
  deadlineMode: "none" as const,
  deadlineDays: null,
  fixedDeadline: null,
  customerSummary: "A sample offer may be available.",
  internalConditions: "Owner confirmation required.",
  sourceConflictNote: null,
};

describe("commercial offer input", () => {
  it("requires an amount for fixed discounts", () => {
    expect(
      commercialOfferInputSchema.safeParse({
        ...validOffer,
        calculationType: "fixed_cents",
        amountCents: null,
      }).success,
    ).toBe(false);
  });

  it("requires basis points for percentage offers", () => {
    expect(
      commercialOfferInputSchema.safeParse({
        ...validOffer,
        calculationType: "percent_basis_points",
        amountCents: null,
        amountBasisPoints: null,
      }).success,
    ).toBe(false);
  });

  it("allows proposed variable payment options without inventing a percentage", () => {
    expect(
      commercialOfferInputSchema.safeParse({
        ...validOffer,
        kind: "payment_option",
        state: "proposed",
        calculationType: "variable",
        amountCents: null,
        amountBasisPoints: null,
      }).success,
    ).toBe(true);
  });

  it("requires relative and fixed deadline values when those modes are chosen", () => {
    expect(
      commercialOfferInputSchema.safeParse({
        ...validOffer,
        deadlineMode: "days_after_trigger",
        deadlineDays: null,
      }).success,
    ).toBe(false);
    expect(
      commercialOfferInputSchema.safeParse({
        ...validOffer,
        deadlineMode: "fixed_date",
        fixedDeadline: null,
      }).success,
    ).toBe(false);
  });

  it("does not allow one offer to be both new-customer-only and repeat-customer-only", () => {
    expect(
      commercialOfferInputSchema.safeParse({
        ...validOffer,
        newCustomerOnly: true,
        repeatCustomerOnly: true,
      }).success,
    ).toBe(false);
  });
});
