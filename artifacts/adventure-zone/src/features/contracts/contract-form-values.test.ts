import { describe, expect, it } from "vitest";

import { commercialTermsFor, editableContractValues } from "./contract-form-values";

describe("contract form values", () => {
  it("normalizes a legacy partial draft into safe unconfirmed legal fields", () => {
    expect(editableContractValues({ eventName: "Pirate Fest - 2026" })).toMatchObject({
      eventName: "Pirate Fest - 2026",
      arrangement: "guaranteed_fee",
      commercialTerms: { arrangement: "guaranteed_fee", totalFeeCents: 0 },
      operationalTerms: { attractionDescription: "", confirmed: false },
      eventSigner: { order: 1 },
      internalSigner: { order: 2 },
      physicalAttractionTotal: null,
    });
  });

  it("creates the complete pay-for-play branch without stale fee fields", () => {
    expect(commercialTermsFor("pay_for_play")).toEqual({
      arrangement: "pay_for_play",
      eventShareBasisPoints: 0,
      settlementTiming: "",
      ticketAuthority: "",
      collectionArrangement: "",
      upfrontChargeCents: 0,
    });
  });
});
