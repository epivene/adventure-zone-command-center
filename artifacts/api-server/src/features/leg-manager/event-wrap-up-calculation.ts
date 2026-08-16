export type WrapUpCalculationInput = {
  revenue: { cashCents: number; nonCashCents: number; otherCashCents: number };
  directExpenses: Array<{
    id: string;
    amountCents: number;
    paymentSource: string;
    countsAsAllocatedTravel: boolean;
  }>;
  travel: {
    tripMiles: number | null;
    allocatedMiles: number;
    mpg: number | null;
    fuelPricePerGallon: number | null;
    actualAllocatedFuelCostCents: number | null;
    overrideMiles: number | null;
    overrideCostCents: number | null;
  };
  actualCashOnHandCents: number | null;
  directAdjustmentsCents: number;
  crewWagesCents: number | null;
  overheadCents: number | null;
  trueProfitAdjustmentsCents: number;
};

export type EventWrapUpCalculation = {
  settlement: {
    cashIncomeCents: number;
    otherCashIncomeCents: number;
    cashExpensesCents: number;
    expectedCashCents: number;
    actualCashCents: number | null;
    differenceCents: number | null;
  };
  travel: {
    tripMiles: number | null;
    automaticMiles: number;
    appliedMiles: number;
    mpg: number | null;
    fuelPricePerGallon: number | null;
    estimatedFuelCostCents: number | null;
    actualAllocatedFuelCostCents: number | null;
    allocatedFuelCostCents: number;
    source: "automatic" | "admin_override";
  };
  directProfit: {
    revenueCents: number;
    directExpenseCents: number;
    travelCostCents: number;
    adjustmentsCents: number;
    profitCents: number;
  };
  trueProfit: {
    directProfitCents: number;
    crewWagesCents: number | null;
    overheadCents: number | null;
    adjustmentsCents: number;
    profitCents: number | null;
    incompleteReasons: string[];
  };
};

function cents(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function nonNegative(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

export function allocateTripMiles(input: {
  segmentMiles: number[];
  stopCount: number;
}): number[] {
  const stopCount = Math.max(0, Math.trunc(input.stopCount));
  if (stopCount === 0) return [];
  const result = Array.from({ length: stopCount }, () => 0);
  const segments = input.segmentMiles.map((miles) =>
    Number.isFinite(miles) && miles > 0 ? miles : 0,
  );

  for (let index = 0; index < segments.length; index += 1) {
    const destinationStop = index === 0
      ? 0
      : Math.min(index, stopCount - 1);
    result[destinationStop] += segments[index] ?? 0;
  }
  return result;
}

export function calculateEventWrapUp(
  input: WrapUpCalculationInput,
): EventWrapUpCalculation {
  const cashIncomeCents = cents(input.revenue.cashCents);
  const otherCashIncomeCents = cents(input.revenue.otherCashCents);
  const nonCashCents = cents(input.revenue.nonCashCents);

  const cashExpensesCents = input.directExpenses
    .filter((expense) => expense.paymentSource === "adventure_zone_cash")
    .reduce((total, expense) => total + cents(expense.amountCents), 0);

  const expectedCashCents =
    cashIncomeCents + otherCashIncomeCents - cashExpensesCents;
  const actualCashCents = input.actualCashOnHandCents == null
    ? null
    : cents(input.actualCashOnHandCents);

  const automaticMiles = nonNegative(input.travel.allocatedMiles);
  const appliedMiles = input.travel.overrideMiles == null
    ? automaticMiles
    : nonNegative(input.travel.overrideMiles);
  const mpg = input.travel.mpg != null && input.travel.mpg > 0
    ? input.travel.mpg
    : null;
  const fuelPricePerGallon =
    input.travel.fuelPricePerGallon != null && input.travel.fuelPricePerGallon > 0
      ? input.travel.fuelPricePerGallon
      : null;
  const estimatedFuelCostCents = mpg && fuelPricePerGallon
    ? cents((appliedMiles / mpg) * fuelPricePerGallon * 100)
    : null;

  const source: EventWrapUpCalculation["travel"]["source"] =
    input.travel.overrideMiles != null || input.travel.overrideCostCents != null
      ? "admin_override"
      : "automatic";

  const allocatedFuelCostCents = input.travel.overrideCostCents != null
    ? cents(input.travel.overrideCostCents)
    : input.travel.actualAllocatedFuelCostCents != null
      ? cents(input.travel.actualAllocatedFuelCostCents)
      : estimatedFuelCostCents ?? 0;

  const directExpenseCents = input.directExpenses
    .filter((expense) => !expense.countsAsAllocatedTravel)
    .reduce((total, expense) => total + cents(expense.amountCents), 0);
  const revenueCents = cashIncomeCents + otherCashIncomeCents + nonCashCents;
  const directAdjustmentsCents = cents(input.directAdjustmentsCents);
  const directProfitCents =
    revenueCents - directExpenseCents - allocatedFuelCostCents + directAdjustmentsCents;

  const incompleteReasons: string[] = [];
  if (input.crewWagesCents == null) incompleteReasons.push("Crew wage cost is incomplete");
  if (input.overheadCents == null) incompleteReasons.push("Overhead allocation is incomplete");
  const trueProfitAdjustmentsCents = cents(input.trueProfitAdjustmentsCents);
  const trueProfitCents = incompleteReasons.length
    ? null
    : directProfitCents
      - cents(input.crewWagesCents ?? 0)
      - cents(input.overheadCents ?? 0)
      + trueProfitAdjustmentsCents;

  return {
    settlement: {
      cashIncomeCents,
      otherCashIncomeCents,
      cashExpensesCents,
      expectedCashCents,
      actualCashCents,
      differenceCents: actualCashCents == null
        ? null
        : actualCashCents - expectedCashCents,
    },
    travel: {
      tripMiles: input.travel.tripMiles,
      automaticMiles,
      appliedMiles,
      mpg,
      fuelPricePerGallon,
      estimatedFuelCostCents,
      actualAllocatedFuelCostCents: input.travel.actualAllocatedFuelCostCents,
      allocatedFuelCostCents,
      source,
    },
    directProfit: {
      revenueCents,
      directExpenseCents,
      travelCostCents: allocatedFuelCostCents,
      adjustmentsCents: directAdjustmentsCents,
      profitCents: directProfitCents,
    },
    trueProfit: {
      directProfitCents,
      crewWagesCents: input.crewWagesCents,
      overheadCents: input.overheadCents,
      adjustmentsCents: trueProfitAdjustmentsCents,
      profitCents: trueProfitCents,
      incompleteReasons,
    },
  };
}
