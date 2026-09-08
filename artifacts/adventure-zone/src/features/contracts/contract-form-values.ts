import type { ContractArrangement, ContractCommercialTerms, ContractOperationalTerms, ContractValues } from "./contract-types";

export function commercialTermsFor(arrangement: ContractArrangement, previous?: Partial<ContractCommercialTerms>): ContractCommercialTerms {
  if (arrangement === "pay_for_play") return {
    arrangement, eventShareBasisPoints: previous?.arrangement === arrangement ? previous.eventShareBasisPoints ?? 0 : 0,
    settlementTiming: previous?.arrangement === arrangement ? previous.settlementTiming ?? "" : "",
    ticketAuthority: previous?.arrangement === arrangement ? previous.ticketAuthority ?? "" : "",
    collectionArrangement: previous?.arrangement === arrangement ? previous.collectionArrangement ?? "" : "",
    upfrontChargeCents: previous?.arrangement === arrangement ? previous.upfrontChargeCents ?? 0 : 0,
  };
  if (arrangement === "guarantee_plus_percentage") return {
    arrangement, guaranteeCents: previous?.arrangement === arrangement ? previous.guaranteeCents ?? 0 : 0,
    depositCents: previous?.arrangement === arrangement ? previous.depositCents ?? 0 : 0,
    depositDueDate: previous?.arrangement === arrangement ? previous.depositDueDate ?? "" : "",
    balanceCents: previous?.arrangement === arrangement ? previous.balanceCents ?? 0 : 0,
    paymentTiming: previous?.arrangement === arrangement ? previous.paymentTiming ?? "" : "",
    eventShareBasisPoints: previous?.arrangement === arrangement ? previous.eventShareBasisPoints ?? 0 : 0,
    percentageBase: previous?.arrangement === arrangement ? previous.percentageBase ?? "" : "",
    ticketAuthority: previous?.arrangement === arrangement ? previous.ticketAuthority ?? "" : "",
    collectionArrangement: previous?.arrangement === arrangement ? previous.collectionArrangement ?? "" : "",
  };
  return {
    arrangement, totalFeeCents: previous?.arrangement === arrangement ? previous.totalFeeCents ?? 0 : 0,
    depositCents: previous?.arrangement === arrangement ? previous.depositCents ?? 0 : 0,
    depositDueDate: previous?.arrangement === arrangement ? previous.depositDueDate ?? "" : "",
    balanceCents: previous?.arrangement === arrangement ? previous.balanceCents ?? 0 : 0,
    paymentTiming: previous?.arrangement === arrangement ? previous.paymentTiming ?? "" : "",
    discountWording: previous?.arrangement === arrangement ? previous.discountWording ?? "" : "",
  };
}

export const blankOperationalTerms: ContractOperationalTerms = {
  operatingStartDate: "", operatingEndDate: "", dailyHours: "", workDayCount: 0,
  arrivalDate: "", departureDate: "", dateOverrideReason: "", attractionDescription: "",
  spaceRequirement: "", exclusivity: "", powerRequirement: "", waterRequirement: "",
  forkliftRequirement: "", lodgingRequirement: "", restroomAccess: "", licensingResponsibilities: "",
  setupTeardownClause: "", additionalTerms: "", confirmed: false,
};

export function editableContractValues(partial: Partial<ContractValues>): ContractValues {
  const arrangement = partial.arrangement ?? partial.commercialTerms?.arrangement ?? "guaranteed_fee";
  return {
    organizationId: partial.organizationId ?? "", organizationName: partial.organizationName ?? "",
    bookingId: partial.bookingId ?? "", eventName: partial.eventName ?? "", venueName: partial.venueName ?? "",
    venueAddress: { address1: "", address2: "", city: "", region: "", postalCode: "", ...partial.venueAddress },
    eventStartDate: partial.eventStartDate ?? "", eventEndDate: partial.eventEndDate ?? "",
    eventSigner: { name: "", role: "", email: "", phone: "", ...partial.eventSigner, order: 1 },
    internalSigner: { name: "Dave Gordon", role: "The Adventure Zone", email: "", phone: "", ...partial.internalSigner, order: 2 },
    packages: partial.packages ?? [], physicalAttractionTotal: partial.physicalAttractionTotal ?? null,
    travelLegName: partial.travelLegName ?? "", arrangement,
    commercialTerms: commercialTermsFor(arrangement, partial.commercialTerms),
    operationalTerms: { ...blankOperationalTerms, ...partial.operationalTerms },
    coi: { certificateHolderName: "", certificateHolderAddress: "", additionalInsuredWording: "", ...partial.coi },
  };
}
