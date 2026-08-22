import { describe, expect, it } from "vitest";
import {
  canUseCommercialOffer,
  validateOfferActivation,
} from "./commercial-offer-policy";
import type { CommercialOfferRecord } from "./commercial-offer-repository";

const offer: CommercialOfferRecord = {
  id: "10000000-0000-4000-8000-000000000001",
  code: "sample_offer",
  name: "Sample offer",
  kind: "discount",
  state: "proposed",
  audience: "customer_safe",
  sourceDocumentId: null,
  calculationType: "fixed_cents",
  amountCents: 50000,
  amountBasisPoints: null,
  calculationScope: "booking",
  stackPolicy: "manual",
  appliesToPackageCodes: [],
  newCustomerOnly: false,
  repeatCustomerOnly: false,
  requiresOwnerConfirmation: true,
  deadlineMode: "none",
  deadlineDays: null,
  fixedDeadline: null,
  customerSummary: "A sample discount may be available.",
  internalConditions: "Owner review required.",
  sourceConflictNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const context = {
  packageCode: null,
  isRepeatCustomer: false,
  isNewCustomer: true,
  currentDate: "2026-08-22",
};

describe("commercial offer policy", () => {
  it("fails closed for a proposed source rule", () => {
    expect(canUseCommercialOffer(offer, context)).toEqual({
      allowed: false,
      reason: "Offer is not active.",
    });
  });

  it("fails closed while per-event owner confirmation is required", () => {
    expect(
      canUseCommercialOffer({ ...offer, state: "active" }, context),
    ).toEqual({
      allowed: false,
      reason: "Owner confirmation is required for this event.",
    });
  });

  it("blocks activation while a source conflict remains", () => {
    expect(
      validateOfferActivation({ ...offer, sourceConflictNote: "7 days vs 15 days" }),
    ).toContain("Resolve or explicitly accept the source conflict before activation.");
  });

  it("blocks customer-safe rules without customer wording", () => {
    expect(
      validateOfferActivation({ ...offer, customerSummary: null }),
    ).toContain("Customer-safe offers require a customer explanation.");
  });
});
