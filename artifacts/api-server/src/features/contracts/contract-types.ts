export type ContractArrangement = "guaranteed_fee" | "pay_for_play" | "guarantee_plus_percentage";

export type ContractSigner = {
  name: string;
  role: string;
  email: string;
  phone: string;
  order: 1 | 2;
};

export type GuaranteedFeeTerms = {
  arrangement: "guaranteed_fee";
  totalFeeCents: number;
  depositCents: number;
  depositDueDate: string;
  balanceCents: number;
  paymentTiming: string;
  discountWording: string;
};

export type PayForPlayTerms = {
  arrangement: "pay_for_play";
  eventShareBasisPoints: number;
  settlementTiming: string;
  ticketAuthority: string;
  collectionArrangement: string;
  upfrontChargeCents: number;
};

export type GuaranteePlusPercentageTerms = {
  arrangement: "guarantee_plus_percentage";
  guaranteeCents: number;
  depositCents: number;
  depositDueDate: string;
  balanceCents: number;
  paymentTiming: string;
  eventShareBasisPoints: number;
  percentageBase: string;
  ticketAuthority: string;
  collectionArrangement: string;
};

export type ContractCommercialTerms = GuaranteedFeeTerms | PayForPlayTerms | GuaranteePlusPercentageTerms;

export type ContractOperationalTerms = {
  operatingStartDate: string;
  operatingEndDate: string;
  dailyHours: string;
  workDayCount: number;
  arrivalDate: string;
  departureDate: string;
  dateOverrideReason: string;
  attractionDescription: string;
  spaceRequirement: string;
  exclusivity: string;
  powerRequirement: string;
  waterRequirement: string;
  forkliftRequirement: string;
  lodgingRequirement: string;
  restroomAccess: string;
  licensingResponsibilities: string;
  setupTeardownClause: string;
  additionalTerms: string;
  confirmed: boolean;
};

export type ContractCoiValues = {
  certificateHolderName: string;
  certificateHolderAddress: string;
  additionalInsuredWording: string;
};

export type ContractValues = {
  organizationId: string;
  organizationName: string;
  bookingId: string;
  eventName: string;
  venueName: string;
  venueAddress: { address1: string; address2: string; city: string; region: string; postalCode: string };
  eventStartDate: string;
  eventEndDate: string;
  eventSigner: ContractSigner;
  internalSigner: ContractSigner;
  packages: Array<{ id: string; name: string }>;
  physicalAttractionTotal: number | null;
  travelLegName: string;
  arrangement: ContractArrangement;
  commercialTerms: ContractCommercialTerms;
  operationalTerms: ContractOperationalTerms;
  coi: ContractCoiValues;
};

export type ContractValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ContractReadiness = {
  ready: boolean;
  errors: ContractValidationIssue[];
  warnings: ContractValidationIssue[];
  coiMissing: Array<keyof ContractCoiValues>;
};
