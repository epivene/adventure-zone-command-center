import { describe, expect, it } from "vitest";
import { COMMERCIAL_OFFER_SEEDS } from "./commercial-offer-seed";

describe("Amy-derived commercial offer seed", () => {
  it("never activates a source-derived offer automatically", () => {
    expect(COMMERCIAL_OFFER_SEEDS).toHaveLength(10);
    expect(COMMERCIAL_OFFER_SEEDS.every((offer) => offer.state === "proposed")).toBe(true);
    expect(COMMERCIAL_OFFER_SEEDS.every((offer) => offer.requiresOwnerConfirmation)).toBe(true);
  });

  it("preserves the convention deadline conflict instead of choosing a window", () => {
    const convention = COMMERCIAL_OFFER_SEEDS.find((offer) => offer.code === "convention_12_percent");
    expect(convention?.deadlineMode).toBe("manual");
    expect(convention?.deadlineDays).toBeNull();
    expect(convention?.sourceConflictNote).toContain("7 days");
    expect(convention?.sourceConflictNote).toContain("15 days");
  });

  it("does not invent a ticket-sales revenue share", () => {
    const ticketSales = COMMERCIAL_OFFER_SEEDS.filter((offer) => offer.kind === "payment_option");
    expect(ticketSales.length).toBeGreaterThan(0);
    expect(ticketSales.every((offer) => offer.calculationType === "variable")).toBe(true);
    expect(ticketSales.every((offer) => offer.amountBasisPoints === null)).toBe(true);
  });

  it("keeps discretionary deals owner-only", () => {
    for (const code of ["good_deal_5_percent", "great_deal_7_percent", "make_it_right_variable"]) {
      expect(COMMERCIAL_OFFER_SEEDS.find((offer) => offer.code === code)?.audience).toBe("owner_only");
    }
  });
});
