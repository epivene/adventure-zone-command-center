import type { ContractValues } from "../contract-types";
import { guaranteedFeeSnapshot } from "./guaranteed-fee.snapshot";

export const guaranteePlusPercentageSnapshot: ContractValues = {
  ...guaranteedFeeSnapshot,
  arrangement: "guarantee_plus_percentage",
  commercialTerms: {
    arrangement: "guarantee_plus_percentage", guaranteeCents: 300_000,
    depositCents: 100_000, depositDueDate: "2026-03-06", balanceCents: 200_000,
    paymentTiming: "upon arrival", eventShareBasisPoints: 500,
    percentageBase: "gross ticket-box sales above $8,000",
    ticketAuthority: "The Adventure Zone sets public ticket prices",
    collectionArrangement: "The Adventure Zone collects ticket-box sales",
  },
};
