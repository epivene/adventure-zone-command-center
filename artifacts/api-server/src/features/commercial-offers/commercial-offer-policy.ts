import type { CommercialOfferRecord } from "./commercial-offer-repository";

export type CommercialOfferUseContext = {
  packageCode: string | null;
  isRepeatCustomer: boolean;
  isNewCustomer: boolean;
  currentDate: string;
};

export function validateOfferActivation(offer: CommercialOfferRecord): string[] {
  const errors: string[] = [];
  if (offer.sourceConflictNote?.trim()) {
    errors.push("Resolve or explicitly accept the source conflict before activation.");
  }
  if (offer.calculationType === "fixed_cents" && offer.amountCents === null) {
    errors.push("Enter the fixed amount.");
  }
  if (
    offer.calculationType === "percent_basis_points" &&
    offer.amountBasisPoints === null
  ) {
    errors.push("Enter the percentage.");
  }
  if (offer.deadlineMode === "manual" && offer.kind === "discount") {
    errors.push("Set the current offer deadline or change the deadline mode before activation.");
  }
  if (!offer.internalConditions.trim()) {
    errors.push("Internal conditions are required.");
  }
  if (offer.audience === "customer_safe" && !offer.customerSummary?.trim()) {
    errors.push("Customer-safe offers require a customer explanation.");
  }
  return errors;
}

export function canUseCommercialOffer(
  offer: CommercialOfferRecord,
  context: CommercialOfferUseContext,
): { allowed: boolean; reason: string | null } {
  if (offer.state !== "active") {
    return { allowed: false, reason: "Offer is not active." };
  }
  if (offer.requiresOwnerConfirmation) {
    return {
      allowed: false,
      reason: "Owner confirmation is required for this event.",
    };
  }
  if (offer.repeatCustomerOnly && !context.isRepeatCustomer) {
    return { allowed: false, reason: "Repeat customers only." };
  }
  if (offer.newCustomerOnly && !context.isNewCustomer) {
    return { allowed: false, reason: "New customers only." };
  }
  if (
    offer.appliesToPackageCodes.length > 0 &&
    (!context.packageCode ||
      !offer.appliesToPackageCodes.includes(context.packageCode))
  ) {
    return { allowed: false, reason: "Offer does not apply to this package." };
  }
  if (offer.fixedDeadline && context.currentDate > offer.fixedDeadline) {
    return { allowed: false, reason: "Offer deadline has passed." };
  }
  return { allowed: true, reason: null };
}
