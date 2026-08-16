import { describe, expect, it } from "vitest";
import {
  allocateTripMiles,
  calculateEventWrapUp,
  type WrapUpCalculationInput,
} from "./event-wrap-up-calculation";

function baseInput(overrides: Partial<WrapUpCalculationInput> = {}): WrapUpCalculationInput {
  return {
    revenue: { cashCents: 100_000, nonCashCents: 50_000, otherCashCents: 0 },
    directExpenses: [],
    travel: {
      tripMiles: 200,
      allocatedMiles: 100,
      mpg: 10,
      fuelPricePerGallon: 3.5,
      actualAllocatedFuelCostCents: null,
      overrideMiles: null,
      overrideCostCents: null,
    },
    actualCashOnHandCents: null,
    directAdjustmentsCents: 0,
    crewWagesCents: 20_000,
    overheadCents: 10_000,
    trueProfitAdjustmentsCents: 0,
    ...overrides,
  };
}

describe("allocateTripMiles", () => {
  it("attributes route segments to the destination stop and final return to the final stop", () => {
    expect(allocateTripMiles({ segmentMiles: [100, 60, 40], stopCount: 2 })).toEqual([100, 100]);
  });

  it("returns one allocation per stop and ignores non-finite or negative mileage", () => {
    expect(allocateTripMiles({ segmentMiles: [25, Number.NaN, -3, 75], stopCount: 3 })).toEqual([25, 0, 75]);
  });
});

describe("calculateEventWrapUp", () => {
  it("calculates cash over/short separately from non-cash revenue", () => {
    const result = calculateEventWrapUp(baseInput({
      revenue: { cashCents: 180_000, nonCashCents: 90_000, otherCashCents: 5_000 },
      directExpenses: [{
        id: "cash-expense",
        amountCents: 12_000,
        paymentSource: "adventure_zone_cash",
        countsAsAllocatedTravel: false,
      }],
      actualCashOnHandCents: 171_500,
    }));

    expect(result.settlement.expectedCashCents).toBe(173_000);
    expect(result.settlement.differenceCents).toBe(-1_500);
    expect(result.directProfit.revenueCents).toBe(275_000);
  });

  it("returns incomplete true profit when crew wages are unknown", () => {
    const result = calculateEventWrapUp(baseInput({ crewWagesCents: null, overheadCents: 25_000 }));
    expect(result.trueProfit.profitCents).toBeNull();
    expect(result.trueProfit.incompleteReasons).toContain("Crew wage cost is incomplete");
  });

  it("returns incomplete true profit when overhead is unknown", () => {
    const result = calculateEventWrapUp(baseInput({ crewWagesCents: 20_000, overheadCents: null }));
    expect(result.trueProfit.profitCents).toBeNull();
    expect(result.trueProfit.incompleteReasons).toContain("Overhead allocation is incomplete");
  });

  it("uses admin travel overrides but keeps automatic values visible", () => {
    const result = calculateEventWrapUp(baseInput({
      travel: {
        tripMiles: 200,
        allocatedMiles: 100,
        mpg: 10,
        fuelPricePerGallon: 4,
        actualAllocatedFuelCostCents: null,
        overrideMiles: 80,
        overrideCostCents: 5_000,
      },
    }));
    expect(result.travel.automaticMiles).toBe(100);
    expect(result.travel.appliedMiles).toBe(80);
    expect(result.travel.allocatedFuelCostCents).toBe(5_000);
    expect(result.travel.source).toBe("admin_override");
  });

  it("does not double-count direct expenses already represented by travel allocation", () => {
    const result = calculateEventWrapUp(baseInput({
      directExpenses: [
        { id: "fuel", amountCents: 3_500, paymentSource: "adventure_zone_debit", countsAsAllocatedTravel: true },
        { id: "supplies", amountCents: 2_000, paymentSource: "adventure_zone_debit", countsAsAllocatedTravel: false },
      ],
    }));
    expect(result.directProfit.directExpenseCents).toBe(2_000);
    expect(result.travel.allocatedFuelCostCents).toBe(3_500);
    expect(result.directProfit.profitCents).toBe(144_500);
  });

  it("applies direct and true-profit adjustments independently", () => {
    const result = calculateEventWrapUp(baseInput({ directAdjustmentsCents: 5_000, trueProfitAdjustmentsCents: -2_500 }));
    expect(result.directProfit.adjustmentsCents).toBe(5_000);
    expect(result.trueProfit.adjustmentsCents).toBe(-2_500);
    expect(result.trueProfit.profitCents).toBe(result.directProfit.profitCents - 20_000 - 10_000 - 2_500);
  });

  it("reports a positive cash difference as an overage", () => {
    const result = calculateEventWrapUp(baseInput({ actualCashOnHandCents: 101_000 }));
    expect(result.settlement.expectedCashCents).toBe(100_000);
    expect(result.settlement.differenceCents).toBe(1_000);
  });
});
