import { describe, expect, it } from "vitest";

import type { ContractArrangement, ContractValues } from "./contract-types";
import { validateContractValues } from "./contract-validation";

function completeValues(
  arrangement: ContractArrangement = "guaranteed_fee",
  commercialTerms: ContractValues["commercialTerms"] = {
    arrangement: "guaranteed_fee",
    totalFeeCents: 500_000,
    depositCents: 250_000,
    depositDueDate: "2026-01-15",
    balanceCents: 250_000,
    paymentTiming: "Before opening on the first operating day",
    discountWording: "",
  },
): ContractValues {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Dinosaur Chamber of Commerce",
    bookingId: "22222222-2222-4222-8222-222222222222",
    eventName: "Stone Age Stampede",
    venueName: "Dinosaur Town Park",
    venueAddress: { address1: "100 Stegosaurus Way", address2: "", city: "Dinosaur", region: "CO", postalCode: "81610" },
    eventStartDate: "2026-06-12",
    eventEndDate: "2026-06-14",
    eventSigner: { name: "Pat Organizer", role: "Event Director", email: "pat@example.com", phone: "307-555-0100", order: 1 },
    internalSigner: { name: "Dave Gordon", role: "The Adventure Zone", email: "dave@example.com", phone: "", order: 2 },
    packages: [{ id: "33333333-3333-4333-8333-333333333333", name: "Adventure Zone" }],
    physicalAttractionTotal: 10,
    travelLegName: "Colorado",
    arrangement,
    commercialTerms,
    operationalTerms: {
      operatingStartDate: "2026-06-12",
      operatingEndDate: "2026-06-14",
      dailyHours: "Noon–10:00 PM",
      workDayCount: 3,
      arrivalDate: "2026-06-11",
      departureDate: "2026-06-15",
      dateOverrideReason: "",
      attractionDescription: "Adventure Zone — 10 attractions",
      spaceRequirement: "A level operating area approved by both parties",
      exclusivity: "Adventure Zone is the exclusive inflatable carnival provider",
      powerRequirement: "Event provides the agreed electrical service",
      waterRequirement: "Event provides potable water access",
      forkliftRequirement: "Event provides forklift support for setup and teardown",
      lodgingRequirement: "Event provides the agreed RV/camping accommodations",
      restroomAccess: "Event provides restroom access for crew",
      licensingResponsibilities: "Each party is responsible for its stated permits and inspections",
      setupTeardownClause: "Adventure Zone controls equipment setup, movement, and teardown",
      additionalTerms: "",
      confirmed: true,
    },
    coi: {
      certificateHolderName: "Town of Dinosaur",
      certificateHolderAddress: "317 Stegosaurus Freeway\nDinosaur, CO 81610",
      additionalInsuredWording: "Town of Dinosaur is additional insured for the event dates.",
    },
  };
}

describe("validateContractValues", () => {
  it.each([
    ["guaranteed_fee", {
      arrangement: "guaranteed_fee", totalFeeCents: 500_000, depositCents: 250_000,
      depositDueDate: "2026-01-15", balanceCents: 250_000,
      paymentTiming: "Before opening", discountWording: "",
    }],
    ["pay_for_play", {
      arrangement: "pay_for_play", eventShareBasisPoints: 1_000,
      settlementTiming: "End of final operating day", ticketAuthority: "Adventure Zone",
      collectionArrangement: "Adventure Zone collects public ticket sales", upfrontChargeCents: 0,
    }],
    ["guarantee_plus_percentage", {
      arrangement: "guarantee_plus_percentage", guaranteeCents: 300_000,
      depositCents: 100_000, depositDueDate: "2026-01-15", balanceCents: 200_000,
      paymentTiming: "Before opening", eventShareBasisPoints: 500,
      percentageBase: "Gross ticket sales above $8,000", ticketAuthority: "Adventure Zone",
      collectionArrangement: "Adventure Zone collects public ticket sales",
    }],
  ] as const)("accepts complete %s terms", (arrangement, commercialTerms) => {
    expect(validateContractValues(completeValues(arrangement, commercialTerms)).errors).toEqual([]);
  });

  it("rejects an inconsistent guaranteed balance", () => {
    const values = completeValues("guaranteed_fee", {
      arrangement: "guaranteed_fee", totalFeeCents: 500_000, depositCents: 250_000,
      depositDueDate: "2026-01-15", balanceCents: 200_000,
      paymentTiming: "Before opening", discountWording: "",
    });
    expect(validateContractValues(values).errors).toContainEqual(expect.objectContaining({
      path: "commercialTerms.balanceCents",
      code: "PAYMENT_TOTAL_MISMATCH",
    }));
  });

  it("requires an explicit percentage base for the hybrid arrangement", () => {
    const values = completeValues("guarantee_plus_percentage", {
      arrangement: "guarantee_plus_percentage", guaranteeCents: 300_000,
      depositCents: 100_000, depositDueDate: "2026-01-15", balanceCents: 200_000,
      paymentTiming: "Before opening", eventShareBasisPoints: 500,
      percentageBase: "", ticketAuthority: "Adventure Zone",
      collectionArrangement: "Adventure Zone collects public ticket sales",
    });
    expect(validateContractValues(values).errors).toContainEqual(expect.objectContaining({ path: "commercialTerms.percentageBase" }));
  });

  it("requires an override reason when travel dates do not contain the event", () => {
    const values = completeValues();
    values.operationalTerms.arrivalDate = "2026-06-13";
    expect(validateContractValues(values).errors).toContainEqual(expect.objectContaining({ path: "operationalTerms.dateOverrideReason" }));
  });

  it("requires distinct, ordered, valid signer identities", () => {
    const values = completeValues();
    values.internalSigner.email = "pat@example.com";
    values.internalSigner.order = 1;
    const paths = validateContractValues(values).errors.map((error) => error.path);
    expect(paths).toContain("internalSigner.email");
    expect(paths).toContain("internalSigner.order");
  });

  it("does not block contract generation when COI details are incomplete", () => {
    const values = completeValues();
    values.coi.additionalInsuredWording = "";
    const result = validateContractValues(values);
    expect(result.errors).toEqual([]);
    expect(result.coiMissing).toEqual(["additionalInsuredWording"]);
  });
});
