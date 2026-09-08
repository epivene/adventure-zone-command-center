import { describe, expect, it } from "vitest";

import type { ContractAutofillSource } from "./contract-autofill";
import { buildContractAutofill } from "./contract-autofill";

const source: ContractAutofillSource = {
  booking: {
    id: "22222222-2222-4222-8222-222222222222", organizationId: "11111111-1111-4111-8111-111111111111",
    name: "Stone Age Stampede", venueName: "Dinosaur Town Park", address1: "100 Stegosaurus Way",
    city: "Dinosaur", region: "CO", postalCode: "81610",
    startsAt: new Date("2026-06-12T12:00:00.000Z"), endsAt: new Date("2026-06-14T22:00:00.000Z"),
    physicalAttractionTotal: 10,
  },
  organization: { id: "11111111-1111-4111-8111-111111111111", name: "Dinosaur Chamber of Commerce" },
  bookingPrimaryContact: { firstName: "Pat", lastName: "Organizer", jobTitle: "Event Director", email: "pat@example.com", phone: "307-555-0100" },
  organizationPrimaryContact: { firstName: "Olivia", lastName: "Office", jobTitle: "Director", email: "olivia@example.com", phone: "307-555-0200" },
  packages: [{ id: "33333333-3333-4333-8333-333333333333", name: "Adventure Zone" }],
  travelLeg: { name: "Colorado" },
  settings: {
    internalSignerName: "Dave Gordon", internalSignerEmail: "dave@example.com", internalSignerOrder: 2,
    insuranceRecipientName: "Sara Toone", insuranceRecipientEmail: "sara@protectiveins.net",
  },
};

describe("buildContractAutofill", () => {
  it("maps source data and supplies safe editable defaults for every builder section", () => {
    const result = buildContractAutofill(source);
    expect(result.values.eventSigner).toEqual({
      name: "Pat Organizer", role: "Event Director", email: "pat@example.com", phone: "307-555-0100", order: 1,
    });
    expect(result.values.internalSigner).toEqual({
      name: "Dave Gordon", role: "The Adventure Zone", email: "dave@example.com", phone: "", order: 2,
    });
    expect(result.values.packages).toEqual([{ id: "33333333-3333-4333-8333-333333333333", name: "Adventure Zone" }]);
    expect(result.values.physicalAttractionTotal).toBe(10);
    expect(result.values.travelLegName).toBe("Colorado");
    expect(result.values.arrangement).toBe("guaranteed_fee");
    expect(result.values.commercialTerms).toEqual({
      guaranteedFeeCents: null,
      depositCents: null,
      balanceCents: null,
      eventPercentageBasisPoints: null,
      percentageBase: null,
      admissionPriceCents: null,
    });
    expect(result.values.operationalTerms).toEqual({
      ticketsPerRide: 0,
      hoursPerDay: 0,
      operatingDays: 0,
      powerConfirmed: false,
      siteAccessConfirmed: false,
      staffingConfirmed: false,
    });
    expect(result.insuranceRecipient).toEqual({ name: "Sara Toone", email: "sara@protectiveins.net" });
  });

  it("uses the organization primary only when the booking has no primary contact", () => {
    const result = buildContractAutofill({ ...source, bookingPrimaryContact: null });
    expect(result.values.eventSigner?.name).toBe("Olivia Office");
    expect(result.sources.eventSigner).toBe("organization_primary_contact");
  });

  it("never selects an arbitrary signer when neither primary contact exists", () => {
    const result = buildContractAutofill({
      ...source,
      bookingPrimaryContact: null,
      organizationPrimaryContact: null,
    });
    expect(result.values.eventSigner).toBeUndefined();
    expect(result.missing).toContain("eventSigner");
  });

  it("flags a missing internal signer email instead of inventing one", () => {
    const result = buildContractAutofill({
      ...source,
      settings: { ...source.settings, internalSignerEmail: null },
    });
    expect(result.values.internalSigner?.email).toBe("");
    expect(result.missing).toContain("internalSigner.email");
  });
});
