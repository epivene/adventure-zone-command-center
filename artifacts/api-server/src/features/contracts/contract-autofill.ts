import { businessDateKey } from "@/lib/business-date";

import type { ContractSigner, ContractValues } from "./contract-types";

type ContactSource = {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
};

export type ContractAutofillSource = {
  booking: {
    id: string;
    organizationId: string | null;
    name: string;
    venueName: string | null;
    address1: string | null;
    city: string;
    region: string;
    postalCode: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    physicalAttractionTotal: number | null;
  };
  organization: { id: string; name: string } | null;
  bookingPrimaryContact: ContactSource | null;
  organizationPrimaryContact: ContactSource | null;
  packages: Array<{ id: string; name: string }>;
  travelLeg: { name: string } | null;
  settings: {
    internalSignerName: string;
    internalSignerEmail: string | null;
    internalSignerOrder: number;
    insuranceRecipientName: string;
    insuranceRecipientEmail: string;
  };
};

function signer(contact: ContactSource): ContractSigner {
  return {
    name: `${contact.firstName} ${contact.lastName}`.trim(),
    role: contact.jobTitle?.trim() ?? "",
    email: contact.email?.trim() ?? "",
    phone: contact.phone?.trim() ?? "",
    order: 1,
  };
}

export function buildContractAutofill(source: ContractAutofillSource): {
  values: Partial<ContractValues>;
  missing: string[];
  sources: Record<string, string>;
  insuranceRecipient: { name: string; email: string };
} {
  const missing: string[] = [];
  const primary = source.bookingPrimaryContact ?? source.organizationPrimaryContact;
  if (!source.organization) missing.push("organization");
  if (!primary) missing.push("eventSigner");
  if (!source.booking.startsAt) missing.push("eventStartDate");
  if (!source.booking.endsAt) missing.push("eventEndDate");
  if (!source.settings.internalSignerEmail?.trim()) missing.push("internalSigner.email");
  if (!source.packages.length) missing.push("packages");

  const internalSigner: ContractSigner = {
    name: source.settings.internalSignerName.trim(),
    role: "The Adventure Zone",
    email: source.settings.internalSignerEmail?.trim() ?? "",
    phone: "",
    order: 2,
  };
  return {
    values: {
      organizationId: source.organization?.id,
      organizationName: source.organization?.name,
      bookingId: source.booking.id,
      eventName: source.booking.name,
      venueName: source.booking.venueName ?? "",
      venueAddress: {
        address1: source.booking.address1 ?? "",
        address2: "",
        city: source.booking.city,
        region: source.booking.region,
        postalCode: source.booking.postalCode ?? "",
      },
      eventStartDate: source.booking.startsAt ? businessDateKey(source.booking.startsAt) : "",
      eventEndDate: source.booking.endsAt ? businessDateKey(source.booking.endsAt) : "",
      eventSigner: primary ? signer(primary) : undefined,
      internalSigner,
      packages: source.packages,
      physicalAttractionTotal: source.booking.physicalAttractionTotal,
      travelLegName: source.travelLeg?.name ?? "",
      arrangement: "guaranteed_fee",
      commercialTerms: {
        guaranteedFeeCents: null,
        depositCents: null,
        balanceCents: null,
        eventPercentageBasisPoints: null,
        percentageBase: null,
        admissionPriceCents: null,
      },
      operationalTerms: {
        ticketsPerRide: 0,
        hoursPerDay: 0,
        operatingDays: 0,
        powerConfirmed: false,
        siteAccessConfirmed: false,
        staffingConfirmed: false,
      },
      coi: { certificateHolderName: "", certificateHolderAddress: "", additionalInsuredWording: "" },
    },
    missing,
    sources: {
      event: "booking",
      eventSigner: source.bookingPrimaryContact ? "booking_primary_contact" : source.organizationPrimaryContact ? "organization_primary_contact" : "missing",
      packages: "booking_package_selections",
      internalSigner: "contract_settings",
    },
    insuranceRecipient: {
      name: source.settings.insuranceRecipientName,
      email: source.settings.insuranceRecipientEmail,
    },
  };
}
