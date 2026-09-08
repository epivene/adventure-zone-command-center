export type ContractArrangement = "guaranteed_fee" | "pay_for_play" | "guarantee_plus_percentage";
export type ContractStatus = "draft" | "ready_for_adobe" | "sent_for_signature" | "partially_signed" | "completed" | "declined" | "cancelled" | "superseded";

export type ContractSigner = {
  name: string;
  role: string;
  email: string;
  phone: string;
  order: number;
};

export type ContractValues = {
  organizationId: string;
  organizationName: string;
  bookingId: string;
  eventName: string;
  venueName: string;
  venueAddress: { address1: string; city: string; region: string; postalCode: string };
  eventStartDate: string;
  eventEndDate: string;
  arrivalDate: string;
  departureDate: string;
  eventSigner: ContractSigner;
  internalSigner: ContractSigner;
  packages: Array<{ id: string; name: string }>;
  physicalAttractionTotal: number;
  travelLegName: string;
  arrangement: ContractArrangement;
  commercialTerms: {
    guaranteedFeeCents: number | null;
    depositCents: number | null;
    balanceCents: number | null;
    eventPercentageBasisPoints: number | null;
    percentageBase: string | null;
    admissionPriceCents: number | null;
  };
  operationalTerms: {
    ticketsPerRide: number;
    hoursPerDay: number;
    operatingDays: number;
    powerConfirmed: boolean;
    siteAccessConfirmed: boolean;
    staffingConfirmed: boolean;
  };
  coi: {
    certificateHolderName: string;
    certificateHolderAddress: string;
    additionalInsuredWording: string;
  };
};

export type ContractDraft = {
  id: string;
  bookingId: string;
  organizationId: string;
  revision: number;
  storedValues: { contract: Partial<ContractValues>; insuranceRecipient: { name: string; email: string } };
  validationState: { ready: boolean; errors: Array<{ path: string; message: string }>; warnings: Array<{ path: string; message: string }> };
};

export type ContractVersion = {
  id: string;
  bookingId: string;
  organizationId: string;
  status: ContractStatus;
  versionNumber?: number;
  predecessorVersionId?: string | null;
  supersedingVersionId?: string | null;
  snapshot: { values: ContractValues; insuranceRecipient: { name: string; email: string } };
  files?: Array<{ id: string; kind: "unsigned_generated" | "signed_completed"; revision: number; originalFilename: string; confirmedAt: string | null }>;
  coiDraft?: { state: "details_needed" | "prepared" | "created" | "retryable_error" | "manual_review"; recipientEmail?: string; subject?: string; gmailMessageId?: string | null } | null;
};
